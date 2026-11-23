package kr.ac.sejong.sai.room

import android.Manifest
import android.app.*
import android.bluetooth.BluetoothManager
import android.content.*
import android.content.pm.PackageManager
import android.hardware.*
import android.net.Uri
import android.os.*
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object Vault {
    private const val alias = "sai-room-local"
    @Synchronized private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun write(c: Context, name: String, value: String) {
        val prefs = c.getSharedPreferences("sai-vault", Context.MODE_PRIVATE)
        if (value.isEmpty()) { prefs.edit().remove(name).commit(); return }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key())
        val bytes = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        check(prefs.edit().putString(name, Base64.encodeToString(bytes, Base64.NO_WRAP)).commit())
    }
    fun read(c: Context, name: String): String? {
        val raw = c.getSharedPreferences("sai-vault", Context.MODE_PRIVATE).getString(name, null) ?: return null
        return try {
            val bytes = Base64.decode(raw, Base64.NO_WRAP); val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0,12)))
            String(cipher.doFinal(bytes.copyOfRange(12,bytes.size)), Charsets.UTF_8)
        } catch (_: Exception) { null }
    }
}
object BeaconAccess {
    fun granted(c:Context,p:String)=c.checkSelfPermission(p)==PackageManager.PERMISSION_GRANTED
    fun foreground(c:Context):Boolean = granted(c,Manifest.permission.ACCESS_FINE_LOCATION) && (Build.VERSION.SDK_INT<31 || (granted(c,Manifest.permission.BLUETOOTH_SCAN)&&granted(c,Manifest.permission.BLUETOOTH_CONNECT)))
    fun ready(c:Context):Boolean = foreground(c) && (Build.VERSION.SDK_INT<29 || granted(c,Manifest.permission.ACCESS_BACKGROUND_LOCATION))
    fun bluetooth(c:Context):Boolean = try { (c.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter?.isEnabled==true } catch (_:SecurityException){false}
    fun status(c:Context):Map<String,Any> = mapOf("paired" to (Vault.read(c,"beacon")!=null), "ready" to ready(c), "active" to (Vault.read(c,"beacon")!=null&&ready(c)&&bluetooth(c)&&BeaconService.running), "message" to when {
        !foreground(c)->"위치와 근처 기기 권한을 허용해주세요."
        !ready(c)->"권한 설정에서 위치를 ‘항상 허용’으로 변경해주세요."
        !bluetooth(c)->"Bluetooth를 켜주세요."
        else->c.getSharedPreferences("sai-status",0).getString("message", "자동 감지 중에는 상태 알림이 표시됩니다.")!!
    })
}
class MainActivity: FlutterActivity(), SensorEventListener, EventChannel.StreamHandler {
    private var pending:MethodChannel.Result?=null
    private var events:EventChannel.EventSink?=null
    private lateinit var sensors:SensorManager
    private var gravity=0.0
    override fun configureFlutterEngine(engine:FlutterEngine) {
        super.configureFlutterEngine(engine); sensors=getSystemService(Context.SENSOR_SERVICE) as SensorManager
        EventChannel(engine.dartExecutor.binaryMessenger,"kr.ac.sejong.sai/motion").setStreamHandler(this)
        MethodChannel(engine.dartExecutor.binaryMessenger,"kr.ac.sejong.sai/native").setMethodCallHandler { call,result ->
            try {
                when(call.method) {
                    "secureRead"->result.success(Vault.read(this,"session"))
                    "secureWrite"->{Vault.write(this,"session",call.argument<String>("value")?:"");result.success(null)}
                    "beaconStatus"->result.success(BeaconAccess.status(this))
                    "beaconPermissions"->permissions(result)
                    "beaconConfigure"->{
                        check(BeaconAccess.ready(this)&&BeaconAccess.bluetooth(this))
                        val args=JSONObject(call.arguments as Map<*,*>); val origin=args.getString("apiOrigin")
                        require(origin=="https://sai-room.vercel.app")
                        java.util.UUID.fromString(args.getString("uuid"));require(args.getInt("major") in 0..65535&&args.getInt("minor") in 0..65535&&args.getString("deviceToken").length>=40)
                        val data=JSONObject();for(k in listOf("apiOrigin","deviceToken","uuid","major","minor"))data.put(k,args.get(k))
                        Vault.write(this,"beacon",data.toString())
                        startForegroundService(Intent(this,BeaconService::class.java).setAction("configure"));result.success(null)
                    }
                    "beaconDisable"->{Vault.write(this,"beacon","");stopService(Intent(this,BeaconService::class.java));result.success(null)}
                    "openSettings"->{startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:$packageName")));result.success(null)}
                    "motionStart"->{sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let{sensors.registerListener(this,it,SensorManager.SENSOR_DELAY_GAME)};result.success(null)}
                    "motionStop"->{sensors.unregisterListener(this);result.success(null)}
                    else->result.notImplemented()
                }
            }catch(_:Exception){result.error("NATIVE_ERROR","기기 권한과 Bluetooth 설정을 확인해주세요.",null)}
        }
    }
    private fun permissions(result:MethodChannel.Result) {
        if(pending!=null){result.error("BUSY","권한 요청 중입니다.",null);return}
        val list=mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION)
        if(Build.VERSION.SDK_INT>=31)list.addAll(listOf(Manifest.permission.BLUETOOTH_SCAN,Manifest.permission.BLUETOOTH_CONNECT))
        if(Build.VERSION.SDK_INT>=33)list.add(Manifest.permission.POST_NOTIFICATIONS)
        val missing=list.filter{!BeaconAccess.granted(this,it)}
        if(missing.isNotEmpty()){pending=result;requestPermissions(missing.toTypedArray(),401);return}
        if(!BeaconAccess.ready(this))startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:$packageName")))
        result.success(BeaconAccess.status(this))
    }
    override fun onRequestPermissionsResult(requestCode:Int,permissions:Array<out String>,grantResults:IntArray) {
        super.onRequestPermissionsResult(requestCode,permissions,grantResults)
        if(requestCode==401){pending?.success(BeaconAccess.status(this));pending=null}
    }
    override fun onListen(arguments:Any?,sink:EventChannel.EventSink){events=sink}
    override fun onCancel(arguments:Any?){events=null;sensors.unregisterListener(this)}
    override fun onSensorChanged(event:SensorEvent){val x=-event.values[0]/SensorManager.GRAVITY_EARTH;gravity=.85*gravity+.15*x;events?.success(listOf(gravity,x-gravity))}
    override fun onAccuracyChanged(sensor:Sensor?,accuracy:Int){}
    override fun onPause(){sensors.unregisterListener(this);super.onPause()}
}
