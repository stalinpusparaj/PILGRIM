package com.pilgrim.narrowway

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader

/**
 * PILGRIM: THE NARROW WAY, Android shell. The built web game (dist/, copied into assets at build time) is
 * served to one full-screen WebView from https://appassets.androidplatform.net/ so it runs on a secure
 * origin (IndexedDB saves, Web Audio) with no network and no data leaving the device.
 */
class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var voice: OfflineVoice
    private lateinit var native: NativeBridge

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // Draw under the camera notch too; the game keeps its controls inside env(safe-area-inset-*).
        if (Build.VERSION.SDK_INT >= 28) window.attributes = window.attributes.apply {
            layoutInDisplayCutoutMode = if (Build.VERSION.SDK_INT >= 30) WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#2B2235"))
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = false
                allowContentAccess = false
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                useWideViewPort = true
                loadWithOverviewMode = true
                textZoom = 100
            }
            isHorizontalScrollBarEnabled = false
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        voice = OfflineVoice(this, webView)
        webView.addJavascriptInterface(voice, "PilgrimVoice")
        native = NativeBridge(this, webView)
        webView.addJavascriptInterface(native, "PilgrimNative")
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            // Nothing in the game leaves the device; any other navigation is dropped.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.scheme != "https" || request.url.host != APP_HOST
        }
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        setContentView(webView)
        hideSystemBars()

        if (savedInstanceState == null) webView.loadUrl("https://$APP_HOST/index.html")
        else webView.restoreState(savedInstanceState)

        // Back = the game's Pause (Esc). The game owns the flow; the app only closes from its own menus.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript(
                    "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));" +
                        "document.dispatchEvent(new KeyboardEvent('keyup',{key:'Escape',code:'Escape',bubbles:true}));",
                    null,
                )
            }
        })
    }

    private fun hideSystemBars() {
        WindowInsetsControllerCompat(window, webView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean =
        if (keyCode == KeyEvent.KEYCODE_BACK) { onBackPressedDispatcher.onBackPressed(); true } else super.onKeyDown(keyCode, event)

    override fun onResume() { super.onResume(); webView.onResume(); webView.resumeTimers(); native.requestFocus(); native.watchThermal(true) }
    override fun onPause() { voice.pause(); native.abandonFocus(); native.watchThermal(false); webView.pauseTimers(); webView.onPause(); super.onPause() }
    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); webView.saveState(outState) }
    override fun onDestroy() { voice.shutdown(); webView.removeJavascriptInterface("PilgrimVoice"); webView.removeJavascriptInterface("PilgrimNative"); webView.destroy(); super.onDestroy() }

    private companion object {
        const val APP_HOST = "appassets.androidplatform.net"
    }
}
