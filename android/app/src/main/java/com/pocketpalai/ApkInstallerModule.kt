package com.pocketpal

import android.content.Intent
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import com.pocketpal.specs.NativeApkInstallerSpec
import java.io.File

// Separate subclass so its manifest entry cannot collide with another
// library's androidx FileProvider declaration.
class ApkFileProvider : FileProvider()

@ReactModule(name = NativeApkInstallerSpec.NAME)
class ApkInstallerModule(reactContext: ReactApplicationContext) :
    NativeApkInstallerSpec(reactContext) {

  override fun install(filePath: String, promise: Promise) {
    try {
      val file = File(filePath)
      if (!file.isFile) {
        promise.reject("E_APK_MISSING", "APK not found: $filePath")
        return
      }
      val context = reactApplicationContext
      val uri =
          FileProvider.getUriForFile(context, "${context.packageName}.apkinstaller", file)
      val intent =
          Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
          }
      context.startActivity(intent)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_APK_INSTALL", e.message, e)
    }
  }
}
