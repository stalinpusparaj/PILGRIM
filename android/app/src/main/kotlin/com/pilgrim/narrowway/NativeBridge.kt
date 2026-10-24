package com.pilgrim.narrowway

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.install.model.UpdateAvailability

/**
 * Native helpers for the web game (src/core/NativeShell.ts): short haptic buzzes, and audio focus, so a phone
 * call or another app's sound pauses the game and silences it until focus comes back.
 */
class NativeBridge(private val context: Context, private val webView: WebView) {
    private val vibrator: Vibrator? =
        if (Build.VERSION.SDK_INT >= 31) (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        else @Suppress("DEPRECATION") (context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator)
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var focus: AudioFocusRequest? = null

    /** pattern: "off,on,off,on..." in ms, at most 8 entries, each under 400 ms. */
    @JavascriptInterface
    fun vibrate(pattern: String) {
        val v = vibrator ?: return
        if (!v.hasVibrator()) return
        val times = pattern.split(',').mapNotNull { it.trim().toLongOrNull()?.coerceIn(0, 400) }.take(8)
        if (times.size < 2) return
        v.vibrate(VibrationEffect.createWaveform(times.toLongArray(), -1))
    }

    private val listener = AudioManager.OnAudioFocusChangeListener { change ->
        val on = change == AudioManager.AUDIOFOCUS_GAIN
        if (on || change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            webView.post { webView.evaluateJavascript("window.__pilgrimNative&&window.__pilgrimNative.audioFocus($on)", null) }
        }
    }

    fun requestFocus() {
        if (Build.VERSION.SDK_INT < 26) return
        val req = focus ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setOnAudioFocusChangeListener(listener)
            .setWillPauseWhenDucked(false)
            .build().also { focus = it }
        audio.requestAudioFocus(req)
    }

    private val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    private val thermal = PowerManager.OnThermalStatusChangedListener { status -> sendThermal(status) }

    /** The current thermal status (the game asks once when it starts; later changes are pushed). */
    @JavascriptInterface
    fun thermalStatus(): Int = if (Build.VERSION.SDK_INT >= 29) power.currentThermalStatus else 0

    private fun sendThermal(status: Int) {
        webView.post { webView.evaluateJavascript("window.__pilgrimNative&&window.__pilgrimNative.thermal($status)", null) }
    }

    /** Android's thermal status to the game (src/core/NativeShell.ts): warm phones drop to 30 fps and a lower resolution. */
    fun watchThermal(on: Boolean) {
        if (Build.VERSION.SDK_INT < 29) return
        if (on) {
            power.addThermalStatusListener(thermal)
            sendThermal(power.currentThermalStatus)
        } else {
            power.removeThermalStatusListener(thermal)
        }
    }

    /** The Play listing of the released app (the debug build shares the release id without ".debug"). */
    private val playId = context.packageName.removeSuffix(".debug")

    private fun launch(intent: Intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { context.startActivity(intent) } catch (_: ActivityNotFoundException) { }
    }

    @JavascriptInterface
    fun openStore() {
        val market = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$playId"))
        try {
            market.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(market)
        } catch (_: ActivityNotFoundException) {
            launch(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$playId")))
        }
    }

    @JavascriptInterface
    fun share(text: String) {
        val body = "${text.take(300)}\nhttps://play.google.com/store/apps/details?id=$playId"
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, body)
        launch(Intent.createChooser(send, null))
    }

    private fun link(name: String): String = when (name) {
        "facebook" -> context.getString(R.string.facebook_url)
        "feedback" -> context.getString(R.string.feedback_email)
        "more" -> context.getString(R.string.developer_id)
        else -> ""
    }.trim()

    @JavascriptInterface
    fun hasLink(name: String): Boolean = link(name).isNotEmpty()

    @JavascriptInterface
    fun openLink(name: String) {
        val target = link(name)
        if (target.isEmpty()) return
        if (name == "feedback") {
            val version = try { context.packageManager.getPackageInfo(context.packageName, 0).versionName } catch (_: Exception) { "" }
            launch(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")).putExtra(Intent.EXTRA_EMAIL, arrayOf(target))
                .putExtra(Intent.EXTRA_SUBJECT, "PILGRIM feedback ($version)"))
        } else if (name == "more") {
            val market = Intent(Intent.ACTION_VIEW, Uri.parse("market://dev?id=$target")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try { context.startActivity(market) } catch (_: ActivityNotFoundException) {
                launch(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/dev?id=$target")))
            }
        } else if (target.startsWith("https://")) {
            launch(Intent(Intent.ACTION_VIEW, Uri.parse(target)))
        }
    }

    /** Asks Google Play whether a newer version is out; the answer goes to the game (src/core/NativeShell.ts). */
    @JavascriptInterface
    fun checkUpdate() {
        AppUpdateManagerFactory.create(context).appUpdateInfo.addOnSuccessListener { info ->
            if (info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE) {
                val code = info.availableVersionCode()
                webView.post { webView.evaluateJavascript("window.__pilgrimNative&&window.__pilgrimNative.update($code)", null) }
            }
        }
    }

    fun abandonFocus() {
        if (Build.VERSION.SDK_INT >= 26) focus?.let { audio.abandonAudioFocusRequest(it) }
    }
}
