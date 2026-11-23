import Flutter
import UIKit
import CoreLocation
import CoreMotion
import Security

// Shared by the Flutter foreground and OS region callbacks after a background launch.
final class SaiVault {
  static let service = "kr.ac.sejong.sai.room"
  static func read(_ key: String) -> String? {
    let q: [String: Any] = [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service, kSecAttrAccount as String:key, kSecReturnData as String:true, kSecMatchLimit as String:kSecMatchLimitOne]
    var result: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
    return String(data:data, encoding:.utf8)
  }
  static func write(_ key: String, _ value: String) throws {
    let q: [String: Any] = [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service, kSecAttrAccount as String:key]
    if value.isEmpty { SecItemDelete(q as CFDictionary); return }
    let values: [String: Any] = [kSecValueData as String:Data(value.utf8), kSecAttrAccessible as String:kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
    let status = SecItemUpdate(q as CFDictionary, values as CFDictionary)
    if status == errSecItemNotFound {
      var insert = q; values.forEach { insert[$0] = $1 }
      guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { throw NSError(domain:"SaiVault",code:1) }
    } else if status != errSecSuccess { throw NSError(domain:"SaiVault",code:Int(status)) }
  }
}
final class SaiBeacon: NSObject, CLLocationManagerDelegate, URLSessionTaskDelegate {
  static let shared = SaiBeacon()
  let manager = CLLocationManager()
  var permissionReply: FlutterResult?
  var completion: (() -> Void)?
  var lastMessage = ""
  private var askingAlways = false
  private var inFlight: UIBackgroundTaskIdentifier = .invalid
  private lazy var network: URLSession = {
    let c = URLSessionConfiguration.background(withIdentifier:"kr.ac.sejong.sai.beacon.upload")
    c.isDiscretionary = false; c.sessionSendsLaunchEvents = true
    c.timeoutIntervalForRequest = 20; c.timeoutIntervalForResource = 90
    return URLSession(configuration:c, delegate:self, delegateQueue:.main)
  }()
  var config: [String: Any]? {
    guard let raw = SaiVault.read("beacon"), let bytes = raw.data(using:.utf8) else { return nil }
    return (try? JSONSerialization.jsonObject(with:bytes)) as? [String:Any]
  }
  override init() { super.init(); manager.delegate = self }
  func region(_ c: [String:Any]) -> CLBeaconRegion? {
    guard let text = c["uuid"] as? String, let uuid = UUID(uuidString:text), let major = c["major"] as? Int, let minor = c["minor"] as? Int, (0...65535).contains(major), (0...65535).contains(minor) else { return nil }
    let r = CLBeaconRegion(uuid:uuid, major:CLBeaconMajorValue(major), minor:CLBeaconMinorValue(minor), identifier:"sai-room")
    r.notifyOnEntry = true; r.notifyOnExit = true; r.notifyEntryStateOnDisplay = true
    return r
  }
  func status() -> [String:Any] {
    let ready = manager.authorizationStatus == .authorizedAlways && CLLocationManager.isMonitoringAvailable(for:CLBeaconRegion.self)
    return ["paired":config != nil, "active":config != nil && ready && UIApplication.shared.backgroundRefreshStatus == .available, "ready":ready, "message":!lastMessage.isEmpty ? lastMessage : ready ? "위치 접근: 항상 허용. 백그라운드 앱 새로 고침과 Bluetooth를 켜두세요." : "설정에서 위치 접근을 ‘항상’으로 허용해주세요."]
  }
  func requestPermissions(_ result: @escaping FlutterResult) {
    guard permissionReply == nil else { result(FlutterError(code:"BUSY",message:"권한을 확인 중입니다.",details:nil)); return }
    guard CLLocationManager.isMonitoringAvailable(for:CLBeaconRegion.self) else { result(["ready":false,"message":"이 기기는 비콘 영역 감지를 지원하지 않습니다."]); return }
    permissionReply = result
    switch manager.authorizationStatus {
    case .notDetermined: manager.requestWhenInUseAuthorization()
    case .authorizedWhenInUse: askingAlways = true; manager.requestAlwaysAuthorization()
    default: finishPermission()
    }
  }
  func finishPermission() { let callback = permissionReply; permissionReply = nil; callback?(status()) }
  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    if manager.authorizationStatus == .authorizedWhenInUse && permissionReply != nil && !askingAlways {
      // A second explicit tap requests Always; do not chain an unexplained prompt.
      lastMessage = "사용 중 허용되었습니다. 자동 입퇴실 켜기를 다시 눌러 ‘항상 허용’을 선택해주세요."
    } else { lastMessage = "" }
    if manager.authorizationStatus != .notDetermined { finishPermission() }
    if manager.authorizationStatus == .authorizedAlways { restore() }
    else if config != nil { for r in manager.monitoredRegions where r.identifier == "sai-room" { manager.stopMonitoring(for:r) } }
  }
  func configure(_ input:[String:Any]) throws {
    guard let origin = input["apiOrigin"] as? String, URL(string:origin)?.scheme == "https", URL(string:origin)?.host == "sai-room.vercel.app", let token = input["deviceToken"] as? String, token.count >= 40, region(input) != nil, manager.authorizationStatus == .authorizedAlways else { throw NSError(domain:"SaiBeacon",code:2) }
    stop()
    let fields:[String:Any] = ["apiOrigin":origin,"deviceToken":token,"uuid":input["uuid"]!,"major":input["major"]!,"minor":input["minor"]!]
    let bytes = try JSONSerialization.data(withJSONObject:fields)
    try SaiVault.write("beacon",String(decoding:bytes,as:UTF8.self)); lastMessage = ""; restore()
  }
  func restore() {
    _ = network // Reattach background URLSession even without a Flutter engine.
    guard manager.authorizationStatus == .authorizedAlways, let c = config, let r = region(c) else { return }
    manager.startMonitoring(for:r)
    manager.requestState(for:r)
  }
  func stop() {
    for r in manager.monitoredRegions where r.identifier == "sai-room" { manager.stopMonitoring(for:r) }
    let oldToken = config?["deviceToken"] as? String
    network.getAllTasks { tasks in tasks.filter { $0.originalRequest?.value(forHTTPHeaderField:"Authorization") == oldToken.map { "Bearer " + $0 } }.forEach { $0.cancel() } }
    try? SaiVault.write("beacon","")
    lastMessage = ""
  }
  func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) { if region.identifier == "sai-room" { send("inside") } }
  func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) { if region.identifier == "sai-room" { send("outside") } }
  func locationManager(_ manager: CLLocationManager, didDetermineState state: CLRegionState, for region: CLRegion) {
    guard region.identifier == "sai-room", state != .unknown else { return }
    send(state == .inside ? "inside" : "outside")
  }
  func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) { lastMessage = "비콘 감지를 시작하지 못했습니다. 위치와 Bluetooth 설정을 확인해주세요." }
  func send(_ state:String) {
    guard let c = config, let origin = c["apiOrigin"] as? String, let token = c["deviceToken"] as? String, let url = URL(string:origin+"/api/v1/beacon/events") else { return }
    let event:[String:Any] = ["eventId":UUID().uuidString,"roomId":"sai-room","state":state,"uuid":c["uuid"]!,"major":c["major"]!,"minor":c["minor"]!,"observedAt":Int64(Date().timeIntervalSince1970*1000)]
    guard let data = try? JSONSerialization.data(withJSONObject:event) else { return }
    let file = FileManager.default.temporaryDirectory.appendingPathComponent("sai-beacon-"+UUID().uuidString+".json")
    do { try data.write(to:file,options:.atomic); try FileManager.default.setAttributes([.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication],ofItemAtPath:file.path) } catch { return }
    var request = URLRequest(url:url); request.httpMethod = "POST"
    request.setValue("Bearer "+token,forHTTPHeaderField:"Authorization"); request.setValue("application/json",forHTTPHeaderField:"Content-Type")
    let task = network.uploadTask(with:request,fromFile:file); task.taskDescription = file.path; task.resume()
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let path = task.taskDescription { try? FileManager.default.removeItem(atPath:path) }
    guard let currentToken = config?["deviceToken"] as? String, task.originalRequest?.value(forHTTPHeaderField:"Authorization") == "Bearer " + currentToken else { return }
    let code = (task.response as? HTTPURLResponse)?.statusCode
    if code == 401 { stop(); lastMessage = "기기 연결이 만료되거나 해제되었습니다. 앱에서 다시 연결해주세요." }
    else if error != nil || code != 200 { lastMessage = "최근 상태를 보내지 못했습니다. 연결을 확인해주세요." }
    else { lastMessage = "" }
    // Never change observedAt on retry: an old event cannot become a fresh observation.
  }
  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) { let callback = completion; completion = nil; callback?() }
}
final class SaiMotion: NSObject, FlutterStreamHandler {
  let manager = CMMotionManager(); var sink: FlutterEventSink?
  func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? { sink=events; return nil }
  func onCancel(withArguments arguments: Any?) -> FlutterError? { stop(); sink=nil; return nil }
  func start() {
    guard manager.isDeviceMotionAvailable else { return }
    manager.deviceMotionUpdateInterval=1/30
    manager.startDeviceMotionUpdates(to:.main) { [weak self] motion,_ in guard let m=motion else{return}; self?.sink?([m.gravity.x, m.userAcceleration.x]) }
  }
  func stop() { manager.stopDeviceMotionUpdates() }
}
@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  let motion = SaiMotion()
  override func application(_ application:UIApplication,didFinishLaunchingWithOptions launchOptions:[UIApplication.LaunchOptionsKey:Any]?) -> Bool {
    SaiBeacon.shared.restore()
    return super.application(application,didFinishLaunchingWithOptions:launchOptions)
  }
  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with:engineBridge.pluginRegistry)
    let messenger=engineBridge.applicationRegistrar.messenger()
    FlutterEventChannel(name:"kr.ac.sejong.sai/motion",binaryMessenger:messenger).setStreamHandler(motion)
    FlutterMethodChannel(name:"kr.ac.sejong.sai/native",binaryMessenger:messenger).setMethodCallHandler { [weak self] call,result in
      let args=call.arguments as? [String:Any] ?? [:]
      do {
        switch call.method {
        case "secureRead": result(SaiVault.read("session"))
        case "secureWrite": try SaiVault.write("session",args["value"] as? String ?? ""); result(nil)
        case "beaconStatus": result(SaiBeacon.shared.status())
        case "beaconPermissions": SaiBeacon.shared.requestPermissions(result)
        case "beaconConfigure": try SaiBeacon.shared.configure(args); result(nil)
        case "beaconDisable": SaiBeacon.shared.stop(); result(nil)
        case "openSettings": if let url=URL(string:UIApplication.openSettingsURLString){UIApplication.shared.open(url)}; result(nil)
        case "motionStart": self?.motion.start(); result(nil)
        case "motionStop": self?.motion.stop(); result(nil)
        default: result(FlutterMethodNotImplemented)
        }
      } catch { result(FlutterError(code:"NATIVE_ERROR",message:"기기 설정을 확인해주세요.",details:nil)) }
    }
  }
  override func application(_ application:UIApplication,handleEventsForBackgroundURLSession identifier:String,completionHandler:@escaping ()->Void) {
    if identifier == "kr.ac.sejong.sai.beacon.upload" { SaiBeacon.shared.completion=completionHandler; SaiBeacon.shared.restore() }
    else { super.application(application,handleEventsForBackgroundURLSession:identifier,completionHandler:completionHandler) }
  }
  override func applicationDidBecomeActive(_ application:UIApplication) {
    super.applicationDidBecomeActive(application); SaiBeacon.shared.finishPermission(); SaiBeacon.shared.restore()
  }
  override func applicationWillResignActive(_ application:UIApplication) { motion.stop(); super.applicationWillResignActive(application) }
}
