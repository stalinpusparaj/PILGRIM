import java.io.FileInputStream
import java.util.Properties
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.FileSystemOperations
import javax.inject.Inject

plugins {
    alias(libs.plugins.android.application)
}

// Release signing: android/keystore.properties (git-ignored) with storeFile, storePassword, keyAlias, keyPassword.
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) load(FileInputStream(keystorePropertiesFile))
}

android {
    namespace = "com.pilgrim.narrowway"
    compileSdk = 37
    defaultConfig {
        applicationId = "com.pilgrim.narrowway"
        minSdk = 26
        targetSdk = 36
        versionCode = 3
        versionName = "0.1.2"
    }
    signingConfigs {
        if (keystorePropertiesFile.exists()) {
            create("release") {
                storeFile = keystorePropertiesFile.parentFile.resolve(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystorePropertiesFile.exists()) signingConfig = signingConfigs.getByName("release")
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    androidResources {
        // The game's files are served as-is from assets; keep them uncompressed for fast streaming.
        noCompress += listOf("js", "css", "html", "json", "svg", "webmanifest", "png", "jpg", "txt")
    }
}

/** Builds the web game (`npm run build` at the repo root) and copies dist/ into the app's assets root. */
val webRoot = rootProject.layout.projectDirectory.dir("..")

val buildWeb = tasks.register<Exec>("buildWeb") {
    description = "Runs `npm run build` for the web game (the repo root)."
    workingDir = webRoot.asFile
    commandLine("npm", "run", "build")
    outputs.dir(webRoot.dir("dist"))
    outputs.upToDateWhen { false }
}

abstract class CopyWebGame : DefaultTask() {
    @get:InputDirectory abstract val distDir: DirectoryProperty
    @get:OutputDirectory abstract val outputDir: DirectoryProperty
    @get:Inject abstract val fs: FileSystemOperations

    @TaskAction fun copy() {
        val dist = distDir.get().asFile
        check(dist.resolve("index.html").exists()) { "dist/index.html is missing: run `npm run build` at the repo root first." }
        fs.sync {
            from(dist) { exclude("**/.DS_Store") }
            into(outputDir)
        }
    }
}

val copyWebGame = tasks.register<CopyWebGame>("copyWebGame") {
    dependsOn(buildWeb)
    distDir.set(webRoot.dir("dist"))
}

androidComponents {
    onVariants { variant -> variant.sources.assets?.addGeneratedSourceDirectory(copyWebGame, CopyWebGame::outputDir) }
}

dependencies {
    implementation(libs.webkit)
    implementation(libs.activity.ktx)
    implementation(libs.core.ktx)
}
