package kr.ac.sejong.sai.room

import android.app.*
import android.bluetooth.BluetoothManager
import android.bluetooth.le.*
import android.content.*
import android.content.pm.ServiceInfo
import android.os.*
import org.json.JSONObject
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

// Native service owns scanning and delivery. Flutter/Dart can be suspended or absent.
class BeaconService: Service() {
    companion object { @Volatile var running=false; private const val channel="sai-presence";private const val notification=1206 }
    private var scanner:BluetoothLeScanner?=null
    private var config:JSONObject?=null
    private val handler=Handler(Looper.getMainLooper())
    private val worker=Executors.newSingleThreadExecutor()
    private var lastSeen=0L;private var firstSeen=0L;private var lastSent=0L;private var inside=false;private var stateKnown=false
    private val callback=object:ScanCallback(){
        override fun onScanResult(type:Int,result:ScanResult){observation(result)}
        override fun onBatchScanResults(results:MutableList<ScanResult>){results.forEach{observation(it)}}
        override fun onScanFailed(code:Int){status("비콘 감지가 중단되었습니다. 앱을 열어 권한과 Bluetooth를 확인해주세요.");stopSelf()}
    }
    private val tick=object:Runnable{override fun run(){
        if(config==null)return
        if(!BeaconAccess.ready(this@BeaconService)||!BeaconAccess.bluetooth(this@BeaconService)){
            status("권한 또는 Bluetooth가 꺼져 자동 감지를 멈췄습니다.");stopScan();stopSelf();return
        }
        val elapsed=SystemClock.elapsedRealtime()
        // Silence is only interpreted while a scan remains active and permissions are intact.
        if((inside||!stateKnown)&&lastSeen>0&&elapsed-lastSeen>90_000){inside=false;stateKnown=true;firstSeen=0;send("outside");lastSent=elapsed}
        handler.postDelayed(this,10_000)
    }}
    override fun onCreate(){super.onCreate();val manager=getSystemService(NotificationManager::class.java);manager.createNotificationChannel(NotificationChannel(channel,"동방 자동 입퇴실",NotificationManager.IMPORTANCE_LOW))}
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
        if(intent?.action=="stop"){
            val old=Vault.read(this,"beacon");Vault.write(this,"beacon","")
            if(old!=null)worker.execute{revoke(JSONObject(old))}
            stopSelf();return START_NOT_STICKY
        }
        val raw=Vault.read(this,"beacon")
        if(raw==null||!BeaconAccess.ready(this)){stopSelf();return START_NOT_STICKY}
        config=JSONObject(raw)
        firstSeen=0;lastSeen=SystemClock.elapsedRealtime();inside=false;stateKnown=false;lastSent=0
        val open=PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop=PendingIntent.getService(this,1,Intent(this,BeaconService::class.java).setAction("stop"),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n=Notification.Builder(this,channel).setSmallIcon(R.drawable.ic_presence).setContentTitle("SAI 자동 입퇴실").setContentText("동방 비콘을 감지하고 있습니다.").setContentIntent(open).setOngoing(true).addAction(Notification.Action.Builder(null,"감지 끄기",stop).build()).build()
        if(Build.VERSION.SDK_INT>=29)startForeground(notification,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)else startForeground(notification,n)
        try {startScan();running=true;status("자동 감지 중 · 알림에서 언제든 끌 수 있습니다.")}catch(_:Exception){status("비콘 감지를 시작하지 못했습니다.");stopSelf();return START_NOT_STICKY}
        handler.removeCallbacks(tick);handler.post(tick);return START_STICKY
    }
    private fun startScan(){
        stopScan();val c=config?:return
        val uuid=UUID.fromString(c.getString("uuid"));val buffer=java.nio.ByteBuffer.allocate(23)
        buffer.put(0x02.toByte()).put(0x15.toByte()).putLong(uuid.mostSignificantBits).putLong(uuid.leastSignificantBits).putShort(c.getInt("major").toShort()).putShort(c.getInt("minor").toShort()).put(0)
        val mask=ByteArray(23){if(it==22)0 else 0xff.toByte()}
        scanner=(getSystemService(BLUETOOTH_SERVICE) as BluetoothManager).adapter.bluetoothLeScanner
        check(scanner!=null)
        scanner!!.startScan(listOf(ScanFilter.Builder().setManufacturerData(0x004c,buffer.array(),mask).build()),ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_POWER).setReportDelay(0).build(),callback)
    }
    private fun stopScan(){try{scanner?.stopScan(callback)}catch(_:SecurityException){};scanner=null}
    private fun observation(result:ScanResult){
        if(result.rssi < -92)return
        val now=SystemClock.elapsedRealtime();if(now-lastSeen>20_000)firstSeen=now
        lastSeen=now
        if(firstSeen==0L)firstSeen=now
        if(!inside&&now-firstSeen>=5000){inside=true;stateKnown=true;send("inside");lastSent=now}
        // A heartbeat is backed by a fresh BLE observation, never a Dart timer.
        else if(inside&&now-lastSent>60_000){send("inside");lastSent=now}
    }
    private fun status(message:String){getSharedPreferences("sai-status",0).edit().putString("message",message).apply()}
    private fun send(state:String){
        val c=config?:return;val token=c.getString("deviceToken")
        val body=JSONObject().put("eventId",UUID.randomUUID().toString()).put("roomId","sai-room").put("state",state).put("uuid",c.getString("uuid")).put("major",c.getInt("major")).put("minor",c.getInt("minor")).put("observedAt",System.currentTimeMillis())
        worker.execute {
            if(Vault.read(this,"beacon")?.let{JSONObject(it).optString("deviceToken")}!=token)return@execute
            try {val response=request(c,"/api/v1/beacon/events","POST",body.toString());
                if(Vault.read(this,"beacon")?.let{JSONObject(it).optString("deviceToken")}!=token)return@execute
                if(response==401){Vault.write(this,"beacon","");handler.post{status("기기 연결이 해제되었습니다. 앱에서 다시 연결해주세요.");stopSelf()}}
                else if(response!=200)status("입퇴실 상태 전송을 확인해주세요.")
                else status("자동 감지 중 · 알림에서 언제든 끌 수 있습니다.")
            }catch(_:Exception){status("네트워크 연결을 기다리고 있습니다. 다음 비콘 감지 시 다시 전송합니다.")}
        }
    }
    private fun request(c:JSONObject,path:String,method:String,body:String?=null):Int {
        require(c.getString("apiOrigin")=="https://sai-room.vercel.app")
        val connection=URL(c.getString("apiOrigin")+path).openConnection() as HttpsURLConnection
        connection.instanceFollowRedirects=false;connection.connectTimeout=15_000;connection.readTimeout=15_000;connection.requestMethod=method
        connection.setRequestProperty("Authorization","Bearer "+c.getString("deviceToken"))
        try {if(body!=null){connection.doOutput=true;connection.setRequestProperty("Content-Type","application/json");connection.outputStream.use{it.write(body.toByteArray(Charsets.UTF_8))}};return connection.responseCode}finally{connection.disconnect()}
    }
    private fun revoke(c:JSONObject){try{request(c,"/api/v1/beacon/connection","DELETE")}catch(_:Exception){status("기기 감지는 꺼졌습니다. 연결 복구 후 앱에서 서버 연결도 해제해주세요.")}}
    override fun onBind(intent:Intent?):IBinder?=null
    override fun onDestroy(){running=false;handler.removeCallbacksAndMessages(null);stopScan();worker.shutdown();super.onDestroy()}
}
class BeaconBootReceiver:BroadcastReceiver(){override fun onReceive(c:Context,intent:Intent){if(intent.action !in listOf(Intent.ACTION_BOOT_COMPLETED,Intent.ACTION_MY_PACKAGE_REPLACED,Intent.ACTION_USER_UNLOCKED))return;if(Vault.read(c,"beacon")==null||!BeaconAccess.ready(c))return;try{c.startForegroundService(Intent(c,BeaconService::class.java))}catch(_:Exception){c.getSharedPreferences("sai-status",0).edit().putString("message","앱을 열어 자동 입퇴실을 다시 시작해주세요.").apply()}}}
