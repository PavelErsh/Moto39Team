#!/usr/bin/env node
/**
 * Патчер нативных проектов Capacitor.
 *
 * Задача: после `npx cap add android/ios` и каждого `cap sync` привести
 * нативные манифесты в состояние, при котором приложение MOTO39 может
 * получать координаты пользователя ДАЖЕ КОГДА ОНО ЗАКРЫТО или свернуто.
 *
 * Что делает скрипт:
 *   • Android — добавляет в AndroidManifest.xml разрешения
 *     ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION,
 *     ACCESS_BACKGROUND_LOCATION, FOREGROUND_SERVICE,
 *     FOREGROUND_SERVICE_LOCATION, POST_NOTIFICATIONS, WAKE_LOCK,
 *     RECEIVE_BOOT_COMPLETED. Без них ОС не даст плагину держать
 *     foreground-service и убьёт процесс, как только пользователь
 *     свернёт приложение.
 *
 *   • iOS — добавляет/обновляет в Info.plist ключи:
 *     - NSLocationWhenInUseUsageDescription
 *     - NSLocationAlwaysAndWhenInUseUsageDescription
 *     - NSLocationAlwaysUsageDescription
 *     - UIBackgroundModes = [location]
 *     Без ключа UIBackgroundModes=location iOS не будет давать
 *     координаты в фоне, а без описаний ОС просто отклонит запрос.
 *
 * Скрипт идемпотентен — можно запускать сколько угодно раз, дубликаты
 * не появятся. Если нативная папка отсутствует (`android/` или `ios/App`),
 * этот шаг тихо пропускается: значит проект пока собирается только под веб.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FRONTEND_DIR = path.resolve(__dirname, '..')

// -----------------------------------------------------------------------------
// Android
// -----------------------------------------------------------------------------

const ANDROID_MANIFEST = path.join(
  FRONTEND_DIR,
  'android',
  'app',
  'src',
  'main',
  'AndroidManifest.xml',
)

/**
 * Разрешения, необходимые, чтобы приложение получало координаты в фоне.
 * android:foregroundServiceType="location" обязателен для Android 10+
 * (без него сервис не запустится).
 */
const ANDROID_PERMISSIONS = [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.WAKE_LOCK',
  'android.permission.RECEIVE_BOOT_COMPLETED',
]

function patchAndroidManifest() {
  if (!fs.existsSync(ANDROID_MANIFEST)) {
    console.log('[patch-native] android/ не найден — шаг Android пропущен')
    return
  }
  let xml = fs.readFileSync(ANDROID_MANIFEST, 'utf8')
  let changed = false

  // 1) Разрешения.
  for (const perm of ANDROID_PERMISSIONS) {
    const line = `    <uses-permission android:name="${perm}" />`
    if (xml.includes(`android:name="${perm}"`)) continue
    xml = xml.replace(
      /<manifest([^>]*)>/,
      (match) => `${match}\n${line}`,
    )
    changed = true
  }

  // 2) foregroundServiceType для сервиса плагина.
  // background-geolocation регистрирует свой BackgroundGeolocationService,
  // ему нужен атрибут foregroundServiceType="location" на Android 10+.
  if (
    xml.includes('BackgroundGeolocationService') &&
    !xml.includes('android:foregroundServiceType="location"')
  ) {
    xml = xml.replace(
      /(<service[^>]*BackgroundGeolocationService[^>]*)(\/?>)/,
      (_m, head, tail) =>
        `${head} android:foregroundServiceType="location"${tail}`,
    )
    changed = true
  }

  if (changed) {
    fs.writeFileSync(ANDROID_MANIFEST, xml, 'utf8')
    console.log('[patch-native] AndroidManifest.xml обновлён')
  } else {
    console.log('[patch-native] AndroidManifest.xml уже настроен')
  }
}

// -----------------------------------------------------------------------------
// iOS
// -----------------------------------------------------------------------------

const IOS_PLIST = path.join(
  FRONTEND_DIR,
  'ios',
  'App',
  'App',
  'Info.plist',
)

const IOS_STRINGS = {
  NSLocationWhenInUseUsageDescription:
    'MOTO39 показывает вашу позицию другим райдерам сообщества на карте.',
  NSLocationAlwaysAndWhenInUseUsageDescription:
    'MOTO39 продолжает показывать вашу позицию другим райдерам, даже когда приложение свернуто, чтобы вас могли найти в поездке.',
  NSLocationAlwaysUsageDescription:
    'MOTO39 продолжает показывать вашу позицию другим райдерам, даже когда приложение свернуто.',
}

function ensurePlistString(plist, key, value) {
  const keyTag = `<key>${key}</key>`
  if (plist.includes(keyTag)) return { plist, changed: false }
  // Вставляем перед закрывающим </dict>.
  const insertion = `    ${keyTag}\n    <string>${value}</string>\n`
  return {
    plist: plist.replace(/<\/dict>\s*<\/plist>\s*$/, `${insertion}</dict>\n</plist>\n`),
    changed: true,
  }
}

function ensurePlistBackgroundLocation(plist) {
  const keyTag = '<key>UIBackgroundModes</key>'
  if (plist.includes(keyTag)) {
    // Ключ есть — проверим, что внутри массива есть «location».
    if (plist.includes('<string>location</string>')) {
      return { plist, changed: false }
    }
    return {
      plist: plist.replace(
        /(<key>UIBackgroundModes<\/key>\s*<array>)/,
        '$1\n        <string>location</string>',
      ),
      changed: true,
    }
  }
  const insertion =
    '    <key>UIBackgroundModes</key>\n' +
    '    <array>\n' +
    '        <string>location</string>\n' +
    '    </array>\n'
  return {
    plist: plist.replace(/<\/dict>\s*<\/plist>\s*$/, `${insertion}</dict>\n</plist>\n`),
    changed: true,
  }
}

function patchIosPlist() {
  if (!fs.existsSync(IOS_PLIST)) {
    console.log('[patch-native] ios/ не найден — шаг iOS пропущен')
    return
  }
  let plist = fs.readFileSync(IOS_PLIST, 'utf8')
  let changed = false

  for (const [key, value] of Object.entries(IOS_STRINGS)) {
    const res = ensurePlistString(plist, key, value)
    plist = res.plist
    changed = changed || res.changed
  }

  const bg = ensurePlistBackgroundLocation(plist)
  plist = bg.plist
  changed = changed || bg.changed

  if (changed) {
    fs.writeFileSync(IOS_PLIST, plist, 'utf8')
    console.log('[patch-native] Info.plist обновлён')
  } else {
    console.log('[patch-native] Info.plist уже настроен')
  }
}

// -----------------------------------------------------------------------------
patchAndroidManifest()
patchIosPlist()
