package com.pilgrim.narrowway

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.util.Locale

/** Only installed offline voices. All engine mutations run on the UI thread. */
class OfflineVoice(context: Context, private val webView: WebView) {
    @Volatile private var ready = false
    @Volatile private var closed = false
    private val engine = TextToSpeech(context.applicationContext) { status ->
        webView.post { ready = status == TextToSpeech.SUCCESS && !closed }
    }
    init {
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String?) {}
            override fun onDone(id: String?) = ended(id)
            override fun onStop(id: String?, interrupted: Boolean) = ended(id)
            @Deprecated("Android callback")
            override fun onError(id: String?) = ended(id)
            override fun onError(id: String?, code: Int) = ended(id)
        })
    }
    private fun voice(lang: String) = if (ready && !closed) {
        val locale = Locale.forLanguageTag(lang)
        engine.voices?.filter { !it.isNetworkConnectionRequired && it.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) != true && it.locale.language == locale.language }
            ?.sortedWith(compareByDescending<android.speech.tts.Voice> { it.locale == locale }.thenByDescending { it.quality })?.firstOrNull()
    } else null

    @JavascriptInterface fun available(lang: String): Boolean = try { voice(lang) != null } catch (_: Exception) { false }
    @JavascriptInterface fun speak(text: String, lang: String, pitch: Double, rate: Double, volume: Double, id: String) {
        webView.post {
            if (closed) return@post
            try {
                val selected = voice(lang)
                if (selected == null || text.length > TextToSpeech.getMaxSpeechInputLength()) { ended(id); return@post }
                engine.voice = selected
                engine.setPitch(pitch.toFloat().coerceIn(0.85f, 1.2f))
                engine.setSpeechRate(rate.toFloat().coerceIn(0.8f, 1.2f))
                val params = android.os.Bundle().apply { putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume.toFloat().coerceIn(0f, 1f)) }
                if (engine.speak(text, TextToSpeech.QUEUE_FLUSH, params, id) == TextToSpeech.ERROR) ended(id)
            } catch (_: Exception) { ended(id) }
        }
    }
    @JavascriptInterface fun stop() { webView.post { if (!closed) engine.stop() } }
    private fun ended(id: String?) {
        if (id == null || closed) return
        webView.post {
            if (!closed) webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('pilgrim:voice-end',{detail:" + JSONObject.quote(id) + "}));", null)
        }
    }
    fun pause() { if (!closed) engine.stop() }
    fun shutdown() { closed = true; ready = false; engine.stop(); engine.shutdown() }
}
