# MY SAM

<p align="center">
  <img src="v0.1/assets/app-icon-steam-achievements-v2.png" alt="MY SAM logo" width="128" height="128">
</p>

Компактний десктоп-менеджер досягнень та ігрової статистики Steam для Windows.

## Що вміє

- Знаходить локальну інсталяцію Steam та визначає, чи запущений `steam.exe`.
- Читає список встановлених ігор зі Steam-маніфестів бібліотек.
- Відкриває будь-яку вибрану гру через Steamworks за AppID.
- Показує список досягнень з чекбоксами.
- Розблоковує або блокує досягнення і одразу викликає `StoreStats`.
- Використовує локальну кешовану схему статистики Steam, з фолбеком на Steam Web API.
- Показує і дозволяє редагувати цілочисельні статистики, якщо схема містить імена.

## Вимоги

- Windows.
- Запущений Steam-клієнт із залогіненим акаунтом.

## Встановлення

Завантаж останню збірку зі [**сторінки релізів**](https://github.com/CpPrice11/steam-achievement-manager/releases/latest):

- **`SteamAchievementManager-vX.Y.Z-setup.exe`** — one-click інсталятор для поточного користувача. Створює ярлик у меню Пуск і видаляється через "Програми та компоненти". Рекомендовано для більшості користувачів.
- **`SteamAchievementManager-vX.Y.Z-portable.exe`** — портативна версія без встановлення.

Обидві збірки самодостатні і не потребують Node.js, npm чи будь-яких інших залежностей.

## Збірка з вихідного коду

Для розробки або самостійної збірки виконуваного файлу потрібні Node.js та npm.

```powershell
npm install
npm run start    # запуск у режимі розробки
npm run dist     # збірка NSIS-інсталятора у Setup/ та portable у Portable/
```

### Пакети для Pullora

[Pullora](https://github.com/CpPrice11/pullora) встановлює програми з GitHub Releases. Для **наступного** релізу MY SAM після збірки виконай:

```powershell
npm ci
npm run check
npm test
npm run dist
npm run release:prepare-pullora
```

Остання команда створює в `release-assets/vX.Y.Z/` два перевірені x64-пакети та `SHA256SUMS.txt`:

```text
SteamAchievementManager-vX.Y.Z-windows-x64-portable.exe
SteamAchievementManager-vX.Y.Z-windows-x64-setup.exe
SHA256SUMS.txt
```

Вона не створює тег і нічого не публікує. Якщо вже є каталог для цієї версії, команда зупиниться замість перезапису. Перш ніж випускати нову версію, онови `package.json`, перевір запуск обох пакетів на цільових Windows і прикріпи всі три файли до **того самого** stable GitHub Release з відповідним тегом. Не замінюй пакети вже опублікованого `v0.6.1` іншими файлами під тим самим тегом. Setup залишається one-click per-user, portable має запускатися без інсталятора; дані користувача зберігаються поза папкою пакета.

На поточній машині звичайна збірка `electron-builder` блокується на розпакуванні `winCodeSign`: Windows не дозволяє створити символічні посилання. Пробна збірка з `--config.win.signAndEditExecutable=false` перевірила пакування та хеші, але залишила EXE з назвою й іконкою Electron; її **не можна публікувати**. Для релізу потрібна повна збірка з ресурсами застосунку та перевірка запуску на Windows 10/11.

Нова іконка використовує знак Steam у композиції з кубком досягнення. Steam і його знак належать Valve; MY SAM не є офіційним продуктом Valve.

Типова іконка MY SAM уже є в [pullora-assets](https://github.com/CpPrice11/pullora-assets). Скриншотів поки немає; у спільне сховище можна додавати лише справжній інтерфейс без приватних даних. Опублікована Pullora `v5.22.1` ще не містить підготовленої локально інтеграції пакетів та медіа, тому самого випуску MY SAM для появи нових можливостей лаунчера недостатньо.

## Структура коду

```text
v0.1/
├─ main.js, preload.js       Electron entrypoints та IPC
├─ renderer.js, index.html   інтерфейс
├─ styles.css                стилі інтерфейсу
├─ domain/                   чиста логіка станів, DLC і діагностики
├─ steam/                    Steam library, Store, schema, worker і native helper
├─ tests/                    unit tests
└─ assets/                   іконки застосунку
```

## Примітки

Зміни досягнень використовують локальний Steamworks API. Steam документує `SetAchievement`, `ClearAchievement` та `StoreStats` як виклики статистики/досягнень для поточного користувача та поточної гри. Деякі ігри або спільноти можуть не схвалювати ручні зміни досягнень/статистики, тож використовуй це лише на власному акаунті та на власний ризик.

Для досягнень і статистики потрібні дані схеми, щоб програма знала API-імена. Спершу програма читає локальні файли Steam `appcache\stats\UserGameStatsSchema_<appid>.bin`. Якщо локальний кеш відсутній, а Steam Web API не повертає схему без ключа, додай свій Steam Web API ключ у налаштуваннях програми. Поточна npm-версія `steamworks.js` підтримує цілочисельну статистику, але не надає методів для float-статистики.

## Кредити

Натхнено [gibbed/SteamAchievementManager](https://github.com/gibbed/SteamAchievementManager) — оригінальний Steam Achievement Manager (SAM) від Rick Gibbed, написаний на C#. MY SAM — це незалежна реалізація на JavaScript / Electron, яка не містить коду оригіналу; вона лише запозичує ідею та назву SAM. Усі заслуги за оригінальну концепцію належать Rick Gibbed.

## Ліцензія

[MIT](LICENSE)
