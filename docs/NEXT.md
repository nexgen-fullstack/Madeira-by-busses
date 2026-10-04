# Що робити далі: план для нової сесії

Документ для наступної сесії розробки. Тут зібрано, де зупинилися і що треба довести до кінця. Мова спілкування з власником — українська.

## Мета власника

**Madeira by busses** — один головний застосунок з усіма автобусами Мадейри: Horários do Funchal, CAM, SIGA Rodoeste й Aerobus. Сайт і APK для телефона, потім публікація в Google Play під назвою **«Madeira by busses»** (так на логотипі; назву обрав власник, вона відрізняється від сайту-путівника «Madeira by Bus»).

## Стан на 4.10.2026

Уся робота зібрана в основній гілці `claude/ecstatic-knuth-std4r7`; з неї щоразу оновлюються:

- сайт https://nexgen-fullstack.github.io/madeirabus/ (workflow **Deploy website**);
- застосунок https://github.com/nexgen-fullstack/madeirabus/releases/latest/download/Madeira-by-busses.apk і пакет для Google Play `Madeira-by-busses.aab` (workflow **Android app**). Давнє посилання `…/MadeiraBus.apk` теж веде на новий застосунок.

Що зроблено:

- номери ліній як на автобусі (110, «раніше 10A»); сітка всіх ліній з пошуком, екран лінії з розкладом від будь-якої зупинки;
- PDF для друку, завантаження й надсилання, зокрема нативно в Android (`DocumentsPlugin.java`);
- вкладка «Краєвиди» з фото й маршрутом туди й назад; розклад на весь день у деталях поїздки;
- **нова назва «Madeira by busses»** скрізь: шапка, `<title>`, PWA, Android (`app_name`, `appName`), PDF і назва файлу (`Madeira-by-busses-110-….pdf`), сповіщення, 10 мов, README, назва APK і релізу;
- **новий логотип** (`branding/logo.jpg`) і **сині кольори** з нього: шапка — синій градієнт із білим знаком і написом; іконки сайту, PWA (звичайна й maskable), Apple, Android (звичайна, кругла, адаптивна, тематична для Android 13+), заставка Android і завантаження в застосунку. Усе збирає `python3 scripts/brand-assets.py`;
- **Google Play:** іконка 512, банер 1024×500, 8 скриншотів англійською, описи 10 мовами — у `branding/play/`; сторінка `privacy.html` з політикою конфіденційності;
- **GPS-супровід після тунелю:** на детальних трасах HF (наприклад, 181 у Curral das Freiras) трекер після втрати GPS шукав автобус біля останньої точки сигналу й застрягав на «автобус їде іншим маршрутом». Тепер вікно пошуку йде за розкладом, а після тунелю чи об'їзду трекер шукає автобус уздовж усього решти маршруту (тести в `tracker.test.ts`).

Ідентифікатор Android `io.github.nexgenfullstack.madeirabus` лишився: його не видно користувачам, а нова версія ставиться поверх старої. Після першої публікації в Play його вже не змінити.

Перевірка: `pnpm check`, e2e-тести й релізна збірка Android (APK і AAB) проходять.

## Наступне завдання: автобуси всього острова

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

## Публікація в Google Play

Готово: пакет `.aab` у кожному релізі, графіка, скриншоти, описи й відповіді для анкет у [branding/play/README.md](../branding/play/README.md), політика конфіденційності https://nexgen-fullstack.github.io/madeirabus/privacy.html.

Лишилося власникові:

1. Акаунт розробника Google Play (одноразовий внесок) і новий застосунок «Madeira by busses».
2. **До першого завантаження** — власний ключ підпису: створити keystore і додати секрети `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (README → Android). Інакше ключем завантаження стане публічний тестовий ключ.
3. Завантажити `Madeira-by-busses.aab` спершу у внутрішнє тестування, заповнити анкети (Data safety, вікова категорія, foreground service «location» з коротким відео).
4. Краще публікувати після розкладів CAM і Rodoeste: тоді опис «усі автобуси Мадейри» буде правдою.

## Корисне

- Перевірка: `pnpm check`, потім `pnpm build && cd apps/web && CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm exec playwright test`.
- Реальні дані: `pnpm data:real` (HF GTFS) створює `apps/web/public/data/network.json`.
- Гілку розробки бере з налаштувань сесії; коміти закінчуються рядками атрибуції.
