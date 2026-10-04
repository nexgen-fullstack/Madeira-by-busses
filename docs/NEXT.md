# Що робити далі: план для нової сесії

Документ для наступної сесії розробки. Тут зібрано, де зупинилися і що треба довести до кінця. Мова спілкування з власником — українська.

## Мета власника

**Повністю нова зібрана версія з усіма автобусами Мадейри**: Horários do Funchal, CAM і SIGA Rodoeste, а також Aerobus. Її треба перевірити на телефоні (Android APK) і в браузері (сайт). Потім — публікація в Google Play під назвою **«Madeira-by-bus»**.

## Стан на 4.10.2026

Уся робота лежить у гілці `claude/peaceful-archimedes-xp6xvt` і запушена, але **ще не злита** в основну гілку `claude/ecstatic-knuth-std4r7`. Тому сайт https://nexgen-fullstack.github.io/madeirabus/ і APK https://github.com/nexgen-fullstack/madeirabus/releases/latest/download/MadeiraBus.apk досі показують **стару** версію.

Що вже зроблено в гілці:

- номери ліній як на автобусі (110, «раніше 10A»);
- сітка всіх ліній з пошуком, екран лінії з розкладом від будь-якої зупинки;
- PDF для друку, завантаження й надсилання, зокрема нативно в Android (`DocumentsPlugin.java`);
- вкладка «Краєвиди» з фото й маршрутом туди й назад;
- розклад на весь день у деталях поїздки;
- картки ліній у стилі застосунку.

Перевірка: `pnpm check` (113 тестів) і 17/17 e2e-тестів проходять, релізна збірка Android збирається.

## Завдання 1. Автобуси всього острова (головне)

Зараз у реальних даних є лише HF: 60 ліній, Funchal. CAM і Rodoeste публікують тільки PDF. Тому 6 місць у «Краєвидах» мають позначку «Скоро», а застосунок показує повідомлення «Ще не додано: CAM, SIGA Rodoeste».

Що вже зібрано в `data/sources/` (workflow **Collect timetable sources**, `scripts/fetch-sources.mjs`):

- `pages.jsonl` — сторінки SIGA.
  - `https://siga.madeira.gov.pt/horarios` — повний перелік ліній і **таблиця «старий номер → новий»** для всіх перевізників (наприклад, CAM 77 → 651, 81 → 181, Rodoeste 1 → 201, 148 → 228).
  - `…/horarios/<id>` (ідентифікатори 8–96, 1000–1002, 2000–2029, 3000–3007, 4000–4023, 5000–5011, 6000–6004) — сторінка кожної лінії з новими номерами варіантів і посиланням на PDF. Наприклад, Rodoeste 6 → 300–311, а CAM 53 → 826/836.
- `pdf-text/*.txt` — текст PDF зі збереженими колонками (близько 199 файлів), і `pdf-bbox/` — координати слів.
  - `rod_*` — Rodoeste: «Horário da carreira regular…».
  - `C*.pdf`, `111/114/129/77/85.pdf` — CAM («COMPANHIA DE AUTOCARROS DA MADEIRA», «SERVIÇO INTERURBANO»).
  - `sam_*` — колишній SAM, тепер CAM. **Текст зашифровано зсувом символів на 3** («)XQFKDO» = «Funchal»), його треба декодувати або брати з `pdf-bbox`.
  - `aerobus_1/2`.
  - Деякі файли — старі новини (`noticias_download_*`), їх треба відсіяти.
- `osm/bus-routes.json`, `osm/bus-stops.json` — маршрути й зупинки SIGA з OpenStreetMap, щоб отримати координати зупинок і траси.

Що зробити:

1. Скласти довідник ліній CAM і Rodoeste із `pages.jsonl`: старий і новий номер, назва, PDF.
2. Написати парсер PDF → GTFS у `packages/pipeline` (CAM, Rodoeste, Aerobus): зупинки, час, дні (робочі, субота, неділя і свята, шкільний і канікулярний періоди).
3. Прив'язати зупинки до OSM і до зупинок HF за назвою й відстанню, щоб пересадки працювали.
4. Об'єднати з фідом HF у `pnpm data:real`, прибрати `--missing 'CAM,SIGA Rodoeste'`.
5. Тести на кожен формат PDF. Звіряння вибірково вручну: 5–10 ліній порівняти з PDF. **Неправильний розклад гірший за відсутній**, тож сумнівні лінії не публікувати, а позначати.
6. Перевірити, що «Краєвиди» (Cabo Girão, Câmara de Lobos, Porto Moniz, Santana, São Lourenço, Balcões) тепер прокладають маршрути.
7. Оновити `docs/data.md`.

Конкурент «Madeira Bus» (madeirabus.com) уже має 84 маршрути від усіх трьох перевізників, тож це реально зробити.

## Завдання 2. Перейменування на «Madeira-by-bus»

Рішення власника: назва в Google Play — **Madeira-by-bus**.

- Замінити «MadeiraBus» в усіх місцях:
  - назва в застосунку (topbar);
  - `<title>`;
  - PWA manifest (`apps/web/vite.config.ts`);
  - Android `strings.xml` (`app_name`, `title_activity_main`);
  - `capacitor.config` (`appName`);
  - назва файлу PDF (`MadeiraBus-110-….pdf`) і підпис у PDF;
  - тексти всіма 10 мовами в `apps/web/src/locales/*.ts`;
  - `README.md`;
  - назва APK у `.github/workflows/android.yml`.
- Пакет Android `io.github.nexgenfullstack.madeirabus` можна залишити, бо в Play його не видно. Якщо міняти, то **до** першої публікації в Play, бо потім змінити вже не вийде. Уже встановлені APK тоді не оновляться.
- **Попередити власника про ризик:** «Madeira by Bus» уже використовує як бренд сайт-путівник https://madeira-by-bus.com: платна книга й PDF, Facebook «madeira.by.bus». Застосунку з такою назвою в Google Play немає, але власник бренду може поскаржитися. Інші зайняті назви:
  - «Madeira Bus» — Google Play, `com.brianopedal.madeira.bus`, сайти madeirabus.com і madeirabus.app;
  - «GiroBus» — офіційний застосунок HF;
  - «SAM Madeira Bus».

  Раніше пропонувалася назва «IlhaBus: Madeira Bus Routes». Остаточно вирішує власник.

- Для Google Play: локалізовані назви й короткі описи для кожної мови. Не використовувати SIGA, HF, CAM, Rodoeste чи «official» у назві.

## Завдання 3. Нова версія, яку можна відкрити

1. Злити гілку `claude/peaceful-archimedes-xp6xvt` в основну через PR, якщо власник погодиться. Альтернатива — запустити `deploy.yml` через workflow_dispatch з гілки: тоді сайт тимчасово, до нічного перевидання, показує гілку.
2. Після злиття `deploy.yml` оновить сайт, а `android.yml` збере новий APK у Releases.
3. Дати власнику **робочі** посилання й перевірити, що там нова версія: є вкладка «Краєвиди», 110 замість 10A, автобуси всього острова.

## Підготовка до Google Play (після завдань 1–3)

- Підписаний AAB замість APK.
- Іконка 512×512, банер 1024×500, скріншоти телефона.
- Політика конфіденційності: геолокація лишається на телефоні.
- Опис усіма мовами.

## Корисне

- Перевірка: `pnpm check`, потім `pnpm build && cd apps/web && CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm exec playwright test`.
- Реальні дані: `pnpm data:real` (HF GTFS) створює `apps/web/public/data/network.json`.
- Гілку розробки бере з налаштувань сесії; коміти закінчуються рядками атрибуції.
