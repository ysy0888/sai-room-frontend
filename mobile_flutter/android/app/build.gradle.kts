import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val releaseProperties = Properties()
val releaseFile = rootProject.file("key.properties")
if (releaseFile.exists()) releaseFile.inputStream().use { releaseProperties.load(it) }

android {
    namespace = "kr.ac.sejong.sai.room"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = System.getenv("SAI_NDK_VERSION") ?: flutter.ndkVersion
    System.getenv("SAI_NDK_PATH")?.let { ndkPath = it }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "kr.ac.sejong.sai.room"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = 26
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (releaseFile.exists()) create("ownerRelease") {
            storeFile = file(releaseProperties.getProperty("storeFile"))
            storePassword = releaseProperties.getProperty("storePassword")
            keyAlias = releaseProperties.getProperty("keyAlias")
            keyPassword = releaseProperties.getProperty("keyPassword")
        }
    }
    buildTypes {
        release {
            // Release signing is injected by the owner; never sign a release with debug keys.
            signingConfig = if (releaseFile.exists()) signingConfigs.getByName("ownerRelease") else null
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
