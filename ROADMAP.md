# Roadmap — Steam Achievement Manager

> Версія документа: 2026-09
> Поточна версія програми: **v0.6.1**

---

## ✅ v0.1 — Випущено

Базова версія із повним функціоналом керування досягненнями.

| Що зроблено |
|---|
| Список ігор з пошуком, фільтрами та сортуванням |
| Завантаження досягнень через Steam schema + Web API + Steamworks |
| Розблокування / блокування досягнень з підтвердженням |
| Таблиця досягнень із сортуванням по всіх стовпцях |
| Фільтри-чіпи: Всі / Розблоковані / Заблоковані / Змінені / DLC |
| Статистика гри (читання та запис числових значень) |
| Резервні копії (backup) з відновленням |
| Журнал змін (Історія) |
| Steam-стильний інтерфейс: точна палітра #171a21 / #66c0f4 / #1b2838 |
| Банер гри (header.jpg зі Steam CDN) |
| Підтримка DLC досягнень з групуванням за джерелом |
| Іконки кнопок, анімація списку, порожній стан з ілюстрацією |
| Темна / світла / системна тема |
| Компактний / звичайний / великий розмір інтерфейсу |
| Портативний exe + NSIS-інсталятор |

---

## ✅ v0.2 — Поліш та швидкодія

*Мета: зробити щоденне використання приємнішим без великих архітектурних змін.*

| Що зроблено |
|---|
| **Virtual scroll** — CSS `content-visibility: auto` на рядках таблиці; браузер рендерить лише видимі рядки |
| **Toast-сповіщення** — стекові тости знизу-праворуч із прогрес-баром і анімацією замість верхнього banner |
| **Bulk selection** — Ctrl+click вибирає/знімає вибір кількох досягнень; окрема панель Розблокувати/Заблокувати |
| **Keyboard shortcuts** — `Ctrl+Z` скасувати зміни, `Ctrl+Enter` підтвердити, `Ctrl+F` фокус на пошук, `Escape` скасувати вибір |
| **Resize sidebar** — drag-handle між sidebar і контентом, ширина зберігається в localStorage |
| **v0.2.5 installer fix** — NSIS повернуто до one-click per-user setup, щоб обійти crash `System.dll` у assisted installer на Windows 10/11 |

---

## ✅ v0.3 — Engine Stability

*Мета: прибрати крихке визначення стану досягнень і підготувати основу для SAM parity без повного rewrite.*

Реліз [v0.3.0](https://github.com/CpPrice11/steam-achievement-manager/releases/tag/v0.3.0) опубліковано 2026-09-17 із setup та portable-збірками.

| Що зроблено / робиться |
|---|
| **Native achievement states** — `steam-flat-helper.ps1` читає `GetAchievementAndUnlockTime`, щоб бачити реально відкриті досягнення без залежності від public Web API |
| **Fallback order** — стан досягнень читається в порядку `native helper → steamworks.js → Web API` |
| **Hidden false positives** — UI не показує досягнення як приховане, якщо Steam/schema вже дали нормальну назву й опис |
| **Native diagnostics** — діагностика показує стан `steamworks.js` і native helper окремо |
| **Regression test** — додано тест для local schema metadata/hidden |

| Що залишилось після v0.3 |
|---|
| Перевірити на реальному Steam профілі Skyrim/інших проблемних іграх, що `stateStatus` показує `loaded-native` |
| Винести весь UI-текст у локалізацію EN/UK у v0.4 |
| Додати stats parity для float/average-rate stats у v0.6 |

---

## ✅ Після v0.3.0 — Неповний стан досягнень

*Статус: випущено у v0.6.0.*

- Непідтверджені Steam стани показуються як невідомі, а не заблоковані; зміни й відновлення з backup для них недоступні.
- Підтверджені стани з native helper, Steamworks та Web API об'єднуються без втрати раніше прочитаного стану.
- Regression test і перевірка синтаксису пройшли. Electron, `win-unpacked` і portable запускаються на поточній Windows 11 зі Steam відкритим.
- Реальний профіль Skyrim Special Edition перевірено через native Steam API: 75/75 станів прочитано, 13 розблоковано, помилок немає.

---

## ⛔ Блокери наступного релізу

- [x] У v0.6.1 виправлено локальні метадані Portal: schema з багатьма мовами більше не обрізається до `icon`, поле `token` пропускається перед перекладом, а підтверджений `gamename` замінює `App 400`. Перевірено локально: Portal 15/15 назв, описів та іконок; Skyrim 75/75.
- [x] У v0.6.1 приховано зайвий рядок `Метадані досягнення недоступні: <API name>` у списку досягнень; fallback-назва й опис залишаються.
- [x] Назви ігор надходять із підтверджених Steam-даних або валідного store fallback; невідомі значення показуються як `App <AppID>`. У 737 локальних записах немає `windows,macos,linux` або `2=Rj`; AppID 72850 успішно отримує назву зі Steam Store.
- [x] На реальному профілі Skyrim Special Edition native helper прочитав 75/75 станів і рівно 13 відкритих досягнень; schema не позначає їх прихованими.
- [ ] Завершити runtime matrix: на поточній Windows зі Steam відкритим пройшли Electron, `win-unpacked`, portable і setup; залишились окрема Windows 10 та Steam-closed, який користувач попросив не запускати.
- [x] Контрольований Spacewar smoke пройшов: `int`, `float`, `AVGRATE` write, stats reset без achievements і no-op achievement write збережені; фінальні stats, achievement states та unlock time не змінилися.
- [ ] Виконати ручний UI smoke для English/Українська після завершення активної гри; статична parity-перевірка 264/264 ключів пройшла.
- [x] Діагностика гри та `game:load` розрізняють `source`, `warnings`, `errors`, щоб fallback не маскував збій native Steam API.

Регресійні приклади: Skyrim, PRAGMATA, `windows,macos,linux`, `2=Rj`, приватний профіль, неповна відповідь Steam і гра без публічних Web API даних. Перед публікацією: `node --check`, тести, чисті артефакти, smoke-test обох exe та відповідність README фактичному інсталятору.

Проміжний крок: випадковий рядок з `appinfo.vdf` більше не стає назвою; непідтверджений AppID передається у store fallback. Знайдено й виправлено `400 Bad Request` для запитів Steam Store з кількома AppID: тепер запит іде окремо для кожного підозрілого запису. Native helper перевіряє ownership; повний `GetAppData` не потрібен для v1.0, доки підтверджений Store fallback повертає назву, а offline-режим чесно показує `App <AppID>`.

Проміжний крок діагностики: `game:load` повертає `source`, `warnings`, `errors`; екран гри показує джерела станів, кількість підтверджених досягнень і помилки fallback. Для DLC додано окремі джерела, помилки schema/state, попередження про таймаути та відмови Store; порожня коректна відповідь не вважається помилкою.

---

## ✅ v0.4 — UI, локалізація, діагностика

*Статус: випущено у v0.6.0; ручний UI smoke лишається перевіркою для v1.0.*

- EN/UK повідомлення для запуску Steam, завантаження гри, станів досягнень, черги та застосування змін винесено в `UI_TRANSLATIONS`.
- Історію, порівняння/відновлення backup і статистику локалізовано; формат дати історії залежить від вибраної мови.
- Налаштування, перевірку бібліотеки та картку діагностики конкретної гри локалізовано; джерела schema/state, native/Steamworks status, ownership, warnings і errors лишаються видимими.
- П'ять системних `window.alert` / `window.confirm` замінено одним native custom dialog з EN/UK, поверненням фокуса, початковим фокусом на безпечній дії та закриттям через `Escape`.
- Hardcoded-text audit завершено: runtime UI-копія зберігається в `UI_TRANSLATIONS`, а в HTML лишилися тільки технічні `AppID` і `Steam`.
- Залишилось: виконати ручний UI smoke для обох мов у запущеному Electron.
- v0.5 розпочато з чистого dry-run diff builder; подальший стан ведеться в секції нижче.

---

## ✅ v0.5 — Safety Workflow

*Статус: випущено у v0.6.0; startup і native no-op achievement write smoke пройдено, інтерактивний diff/undo UI smoke лишається перевіркою для v1.0.*

- [x] Чистий dry-run builder формує `before`, `after`, дію та причину блокування до звернення до Steam; missing, unreadable і protected записи не потрапляють у apply.
- [x] Показати локалізований візуальний diff «було → стане» у confirmation dialog перед записом у Steam; список обмежено 12 рядками з коректним overflow.
- [x] Відновлення з backup та per-game undo через інтерфейс: undo доступний для останньої успішної операції кожної гри й лише готує чергу.
- [x] Read-only для досягнень і статистики з обмеженнями Steam schema; protected stats також блокують небезпечний global reset.
- [x] Перемикання гри більше не очищає pending changes без підтвердження; старі write IPC, які обходили dry-run, видалено.

v0.6 завершено нижче. Перед релізом окремо виконати контрольований apply/undo smoke у Steam.

---

## ✅ v0.6 — Stats Parity

*Статус: випущено у v0.6.0; native читання, no-op запис і reset на нульових stats Spacewar перевірено.*

Реліз [v0.6.0](https://github.com/CpPrice11/steam-achievement-manager/releases/tag/v0.6.0) містить завершені зміни v0.4–v0.6 у setup та portable-збірках.
Патч [v0.6.1](https://github.com/CpPrice11/steam-achievement-manager/releases/tag/v0.6.1) виправляє локальні метадані Portal і прибирає зайвий рядок про недоступні метадані.

- [x] Local schema розпізнає реальні Steam типи `INT`, `FLOAT` та `AVGRATE`; невідомі типи не перетворюються на `int`.
- [x] Native helper читає й записує int/float через Steam API, а average-rate оновлює через `UpdateAvgRateStat(count, sessionLength)`.
- [x] UI має окремі поля кількості та тривалості для average-rate, показує локалізовані причини для unreadable/unsupported stats і не дозволяє змінювати schema type.
- [x] Stats IPC приймає лише назви й типи з кешованої Steam schema, перевіряє числові межі та зберігає read-only захист backend-рівня.
- [x] Reset stats виконується через native API з fallback і потребує трьох послідовних custom confirmations; achievements не скидаються.
- [x] Для Steam без стандартного `HKCU InstallPath` helper використовує короткочасний registry bridge під mutex і очищає його одразу після ініціалізації.

Runtime перевірено: паралельна native діагностика двох AppID, читання і no-op запис `int`, `float`, `AVGRATE`, а також reset нульових stats Spacewar пройшли. `ResetAllStats(false)` не змінив два achievement states або unlock time; тимчасовий registry value очищено.

---

## 🚀 v1.0 — Стабільний реліз

*Критерій: Win10/Win11 запуск, точні назви ігор та стани досягнень, backup/undo, EN/UK, smoke-test setup і portable.*

*Статус: передрелізні автоматичні перевірки, setup і контрольовані Steam write/reset smoke пройдено; залишилися Windows 10, відкладений Steam-closed та ручний EN/UK UI smoke.*

Передрелізний Ponytail audit від 2026-09-22: нових зайвих залежностей або спекулятивних абстракцій не знайдено; реєстр `ponytail:` порожній. Видалено два невикористані legacy-файли `app-icon.ico` і `app-icon.png`; активні Pullora-значки залишилися єдиними assets логотипа.

Dashboard, card view, planner, import/export та Steam Deck theme залишаються у v2.0. Інші функції не блокують v1.0.

---

## 🌟 v2.0 — Великий реліз

*Мета: стати найкращим менеджером досягнень Steam на Windows. Нові екрани, нові можливості.*

| # | Завдання | Опис |
|---|---|---|
| 1 | **Dashboard** | Головний екран з загальною статистикою бібліотеки: кількість ігор, % виконаних досягнень, топ-10 по прогресу, графік активності |
| 2 | **Card view** | Альтернатива таблиці — великі картки із значком досягнення у стилі Steam-трофею; перемикається одним кліком |
| 3 | **Achievement planner** | Позначити досягнення як «хочу отримати», сформувати план сесії |
| 4 | **Import / Export** | Експортувати стан досягнень у JSON, імпортувати з іншого профілю або бекапу стороннього SAM |
| 5 | **Steam Deck theme** | Третя тема: OLED-чорний (`#000000`) фон, більші target-зони для сенсорного екрану |
| 6 | **Розширена діагностика** | Визначення ігор з відомими патчами анти-читу, перевірка VAC-статусу перед змінами |

---

## 📐 Технічний борг (будь-яка версія)

- Покрити ключові функції unit-тестами (особливо `sortAchievements`, `getFilteredAchievements`)
- Перенести стилі на CSS-змінні для всіх hardcoded кольорів що залишились
- Версіонування папки: при достатньо великому оновленні `v0.1/` → `v0.2/` тощо

Структуру backend упорядковано: Electron/UI entrypoints залишено в `v0.1/`, чисту логіку перенесено в `v0.1/domain/`, інтеграції Steam — у `v0.1/steam/`. Подальше дроблення `main.js` і `renderer.js` робити лише разом із конкретним функціональним етапом, а не заради кількості файлів.

---

## 🗓 Приблизний порядок

```
v0.1 ── базовий функціонал
         │
v0.2 ── virtual scroll · toasts · bulk select · shortcuts · resize
         │
v0.3 ── native achievement state · hidden false positives · diagnostics
         │
v0.4 ── i18n cleanup · custom dialogs · game diagnostics
         │
v0.5 ── dry-run · diff · backup/undo · protected read-only
         │
v0.6 ── float/average-rate stats · reset confirmation
         │
v1.0 ── Win10/Win11 · accurate states · release smoke
         │
v2.0 ── dashboard · card view · planner · import/export
```

---

*Останнє оновлення: 2026-09-22*
