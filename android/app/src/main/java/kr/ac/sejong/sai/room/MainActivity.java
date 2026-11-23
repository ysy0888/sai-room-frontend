package kr.ac.sejong.sai.room;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import kr.ac.sejong.sai.room.beacon.SaiBeaconPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge starts.
        registerPlugin(SaiBeaconPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
