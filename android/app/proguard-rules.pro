# The app is a WebView shell; nothing reflective. Keep the JS bridge name readable if one is ever added.
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
