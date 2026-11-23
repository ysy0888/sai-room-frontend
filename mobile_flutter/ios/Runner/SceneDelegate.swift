import Flutter
import UIKit
class SceneDelegate: FlutterSceneDelegate {
  override func sceneDidBecomeActive(_ scene: UIScene) {
    super.sceneDidBecomeActive(scene)
    SaiBeacon.shared.finishPermission()
    SaiBeacon.shared.restore()
  }
  override func sceneWillResignActive(_ scene: UIScene) {
    (UIApplication.shared.delegate as? AppDelegate)?.motion.stop()
    super.sceneWillResignActive(scene)
  }
}
