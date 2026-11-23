package kr.ac.sejong.sai.room.beacon;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Reads the club-room iBeacon (HE5) and forwards RSSI readings to the web app.
 *
 * Only readings are produced here; the web app decides enter/stay/exit and the server does the counting.
 * It does NOT talk to the beacon manager app and keeps no location history.
 *
 * Supported range (see docs/BEACON.md):
 *  - App open and visible: low-latency hardware-filtered scan.
 *  - App in background: switches to a low-power scan; Android may throttle or stop it and the WebView
 *    may pause, so periodic background reporting is NOT guaranteed (no foreground service on purpose).
 *
 * Permissions: Android 12+ needs BLUETOOTH_SCAN *without* neverForLocation (that flag filters beacons)
 * plus location; Android 11 and lower need location.
 */
@CapacitorPlugin(
    name = "SaiBeacon",
    permissions = {
        @Permission(alias = SaiBeaconPlugin.SCAN, strings = { Manifest.permission.BLUETOOTH_SCAN }),
        @Permission(alias = SaiBeaconPlugin.LOCATION, strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION })
    }
)
public class SaiBeaconPlugin extends Plugin {

    static final String SCAN = "scan";
    static final String LOCATION = "location";

    private BluetoothLeScanner scanner;
    private ScanCallback callback;
    private BroadcastReceiver bluetoothReceiver;
    private String uuid;
    private Integer major;
    private Integer minor;
    private boolean foreground = true;

    private String[] aliases() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? new String[] { SCAN, LOCATION } : new String[] { LOCATION };
    }

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    private JSObject status() {
        JSObject result = new JSObject();
        BluetoothAdapter adapter = adapter();
        boolean le = getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE);
        result.put("bluetooth", adapter == null || !le ? "unsupported" : adapter.isEnabled() ? "on" : "off");
        String permission = "granted";
        for (String alias : aliases()) {
            PermissionState state = getPermissionState(alias);
            if (state == PermissionState.DENIED) { permission = "denied"; break; }
            if (state != PermissionState.GRANTED) permission = "prompt";
        }
        result.put("permission", permission);
        result.put("platform", "android");
        return result;
    }

    @PluginMethod
    public void checkStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        if ("granted".equals(status().getString("permission"))) { call.resolve(status()); return; }
        requestPermissionForAliases(aliases(), call, "accessCallback");
    }

    @PermissionCallback
    private void accessCallback(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void start(PluginCall call) {
        String wanted = call.getString("uuid");
        if (IBeaconParser.uuidBytes(wanted) == null) { call.reject("Invalid beacon UUID", "INVALID_UUID"); return; }
        if (!"granted".equals(status().getString("permission"))) { call.reject("Permission required", "PERMISSION_DENIED"); return; }
        BluetoothAdapter adapter = adapter();
        if (adapter == null || !adapter.isEnabled()) { call.reject("Bluetooth is off", "BLUETOOTH_OFF"); return; }
        uuid = wanted.toLowerCase(Locale.ROOT);
        major = call.getInt("major");
        minor = call.getInt("minor");
        registerBluetoothReceiver();
        startScan();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        uuid = null;
        stopScan();
        unregisterBluetoothReceiver();
        call.resolve();
    }

    @SuppressLint("MissingPermission")
    private synchronized void startScan() {
        stopScan();
        BluetoothAdapter adapter = adapter();
        if (uuid == null || adapter == null || !adapter.isEnabled()) return;
        scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) return;
        ScanFilter filter = new ScanFilter.Builder()
            .setManufacturerData(IBeaconParser.APPLE, IBeaconParser.filterData(uuid, major, minor), IBeaconParser.filterMask(major, minor))
            .build();
        ScanSettings settings = new ScanSettings.Builder()
            .setScanMode(foreground ? ScanSettings.SCAN_MODE_LOW_LATENCY : ScanSettings.SCAN_MODE_LOW_POWER)
            .build();
        callback = new ScanCallback() {
            @Override
            public void onScanResult(int type, ScanResult result) { deliver(result); }

            @Override
            public void onBatchScanResults(List<ScanResult> results) { for (ScanResult r : results) deliver(r); }

            @Override
            public void onScanFailed(int code) {
                JSObject event = new JSObject();
                event.put("error", "SCAN_FAILED_" + code);
                notifyListeners("state", event);
            }
        };
        try {
            scanner.startScan(Collections.singletonList(filter), settings, callback);
        } catch (SecurityException denied) {
            JSObject event = new JSObject();
            event.put("permission", "denied");
            notifyListeners("state", event);
        }
    }

    @SuppressLint("MissingPermission")
    private synchronized void stopScan() {
        if (scanner != null && callback != null) {
            try { scanner.stopScan(callback); } catch (RuntimeException ignored) { /* adapter already off */ }
        }
        scanner = null;
        callback = null;
    }

    private void deliver(ScanResult result) {
        ScanRecord record = result.getScanRecord();
        if (record == null) return;
        IBeaconParser.Beacon beacon = IBeaconParser.parse(record.getManufacturerSpecificData(IBeaconParser.APPLE));
        if (beacon == null || !beacon.matches(uuid, major, minor)) return;
        JSObject reading = new JSObject();
        reading.put("rssi", result.getRssi());
        reading.put("uuid", beacon.uuid);
        reading.put("major", beacon.major);
        reading.put("minor", beacon.minor);
        notifyListeners("reading", reading);
    }

    private void registerBluetoothReceiver() {
        if (bluetoothReceiver != null) return;
        bluetoothReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                int state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR);
                JSObject event = new JSObject();
                if (state == BluetoothAdapter.STATE_OFF) { stopScan(); event.put("bluetooth", "off"); notifyListeners("state", event); }
                else if (state == BluetoothAdapter.STATE_ON) { event.put("bluetooth", "on"); notifyListeners("state", event); startScan(); }
            }
        };
        ContextCompat.registerReceiver(getContext(), bluetoothReceiver, new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    private void unregisterBluetoothReceiver() {
        if (bluetoothReceiver == null) return;
        try { getContext().unregisterReceiver(bluetoothReceiver); } catch (IllegalArgumentException ignored) { /* not registered */ }
        bluetoothReceiver = null;
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        foreground = false;
        if (uuid != null) startScan(); // restart as a low-power scan
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        foreground = true;
        if (uuid != null) startScan(); // back to low latency
    }

    @Override
    protected void handleOnDestroy() {
        uuid = null;
        stopScan();
        unregisterBluetoothReceiver();
        super.handleOnDestroy();
    }
}
