import Foundation
import CoreLocation
import Capacitor

/// Registers the local SaiBeacon plugin before the web view loads.
class SaiBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SaiBeaconPlugin())
    }
}

/// Reads the club-room iBeacon (HE5) with Core Location ranging and forwards RSSI readings to the web app.
///
/// iOS hides iBeacon advertisements from Core Bluetooth, so Core Location is the supported API.
/// Only "When In Use" location permission is requested: ranging runs while the app is open on screen.
/// When the app is backgrounded or the screen is locked, iOS suspends ranging, readings stop, and the
/// member drops out of the count after the server's exit-grace time. Background region monitoring
/// ("Always" permission) is intentionally not implemented in this minimal version (see docs/BEACON.md).
/// Core Location does not expose the Bluetooth power state, so `bluetooth` is reported as "unknown";
/// with Bluetooth off, no readings arrive and the web app exits after its timeout.
@objc(SaiBeaconPlugin)
public class SaiBeaconPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "SaiBeaconPlugin"
    public let jsName = "SaiBeacon"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private var manager: CLLocationManager?
    private var constraint: CLBeaconIdentityConstraint?
    private var pendingAccess: [CAPPluginCall] = []

    /// CLLocationManager must live on a thread with a run loop: always use it on the main queue.
    private func withManager(_ body: @escaping (CLLocationManager) -> Void) {
        DispatchQueue.main.async {
            if self.manager == nil {
                let created = CLLocationManager()
                created.delegate = self
                self.manager = created
            }
            body(self.manager!)
        }
    }

    private func status(_ manager: CLLocationManager) -> [String: Any] {
        let permission: String
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: permission = "granted"
        case .denied, .restricted: permission = "denied"
        default: permission = "prompt"
        }
        return [
            "bluetooth": CLLocationManager.isRangingAvailable() ? "unknown" : "unsupported",
            "permission": permission,
            "platform": "ios"
        ]
    }

    @objc func checkStatus(_ call: CAPPluginCall) {
        withManager { call.resolve(self.status($0)) }
    }

    @objc func requestAccess(_ call: CAPPluginCall) {
        withManager { manager in
            if manager.authorizationStatus == .notDetermined {
                self.pendingAccess.append(call)
                manager.requestWhenInUseAuthorization()
            } else {
                call.resolve(self.status(manager))
            }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard let raw = call.getString("uuid"), let uuid = UUID(uuidString: raw) else {
            call.reject("Invalid beacon UUID", "INVALID_UUID")
            return
        }
        let major = call.getInt("major").flatMap { (0...65535).contains($0) ? CLBeaconMajorValue($0) : nil }
        let minor = call.getInt("minor").flatMap { (0...65535).contains($0) ? CLBeaconMinorValue($0) : nil }
        withManager { manager in
            guard self.status(manager)["permission"] as? String == "granted" else {
                call.reject("Permission required", "PERMISSION_DENIED")
                return
            }
            guard CLLocationManager.isRangingAvailable() else {
                call.reject("Beacon ranging is not available on this device", "UNSUPPORTED")
                return
            }
            if let previous = self.constraint { manager.stopRangingBeacons(satisfying: previous) }
            let next: CLBeaconIdentityConstraint
            if let major = major, let minor = minor {
                next = CLBeaconIdentityConstraint(uuid: uuid, major: major, minor: minor)
            } else if let major = major {
                next = CLBeaconIdentityConstraint(uuid: uuid, major: major)
            } else {
                next = CLBeaconIdentityConstraint(uuid: uuid)
            }
            self.constraint = next
            manager.startRangingBeacons(satisfying: next)
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        withManager { manager in
            if let current = self.constraint { manager.stopRangingBeacons(satisfying: current) }
            self.constraint = nil
            call.resolve()
        }
    }

    // MARK: - CLLocationManagerDelegate

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let current = status(manager)
        pendingAccess.forEach { $0.resolve(current) }
        pendingAccess.removeAll()
        if constraint != nil, current["permission"] as? String != "granted" {
            notifyListeners("state", data: ["permission": "denied"])
        }
    }

    public func locationManager(_ manager: CLLocationManager, didRange beacons: [CLBeacon], satisfying beaconConstraint: CLBeaconIdentityConstraint) {
        for beacon in beacons where beacon.rssi != 0 { // rssi 0 = not measured in this cycle
            notifyListeners("reading", data: [
                "rssi": beacon.rssi,
                "uuid": beacon.uuid.uuidString.lowercased(),
                "major": beacon.major.intValue,
                "minor": beacon.minor.intValue
            ])
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailRangingFor beaconConstraint: CLBeaconIdentityConstraint, error: Error) {
        notifyListeners("state", data: ["error": error.localizedDescription])
    }
}
