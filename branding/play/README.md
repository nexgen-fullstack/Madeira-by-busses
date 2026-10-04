# Google Play: сторінка Madeira by busses

Усе, що просить Play Console для сторінки застосунку. Графіку збирає `python3 scripts/brand-assets.py`, скриншоти — `node scripts/screenshots.mjs play`.

| Що                               | Файл / значення                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Пакет для завантаження           | `Madeira-by-busses.aab` з [останнього релізу](https://github.com/nexgen-fullstack/madeirabus/releases/latest)                              |
| Іконка 512×512                   | [`icon-512.png`](icon-512.png)                                                                                                             |
| Банер (feature graphic) 1024×500 | [`feature-graphic.png`](feature-graphic.png)                                                                                               |
| Скриншоти телефона 1080×2160     | [`screenshots/`](screenshots/)                                                                                                             |
| Назва                            | **Madeira by busses** (однакова для всіх мов)                                                                                              |
| Категорія                        | Карти й навігація (Maps & Navigation)                                                                                                      |
| Політика конфіденційності        | https://nexgen-fullstack.github.io/madeirabus/privacy.html                                                                                 |
| Реклама                          | Немає                                                                                                                                      |
| Безпека даних (Data safety)      | Дані не збираються й не передаються: геопозиція обробляється лише на пристрої. Шифрування передачі — так (https). Видалення — не потрібне. |
| Вікова категорія                 | Для всіх (анкета IARC: без насильства, покупок, спілкування користувачів)                                                                  |
| Foreground service: location     | «Стежить за поїздкою автобусом із вимкненим екраном і попереджає, коли виходити». Play попросить коротке відео, як це працює.              |

Ідентифікатор застосунку: `io.github.nexgenfullstack.madeirabus`. Після першої публікації в Play його вже не змінити.

**Ключ підпису.** Play Console зберігає ключ підпису сам (Play App Signing), а пакет `.aab` підписується ключем завантаження. Зараз це публічний тестовий ключ із репозиторію; для Play краще один раз створити власний і додати його в секрети `ANDROID_KEYSTORE_*` (див. README → Android) **до** першого завантаження.

## Короткий опис (до 80 символів)

| Мова | Текст                                                                            |
| ---- | -------------------------------------------------------------------------------- |
| en   | Madeira buses: routes, timetables, fares and GPS stop alerts. Works offline.     |
| pt   | Autocarros da Madeira: percursos, horários, tarifas e alertas GPS. Sem internet. |
| uk   | Автобуси Мадейри: маршрути, розклади, ціни й GPS-підказки. Працює офлайн.        |
| de   | Busse auf Madeira: Routen, Fahrpläne, Preise und GPS-Ausstiegsalarm. Offline.    |
| fr   | Bus de Madère : trajets, horaires, tarifs et alertes GPS. Fonctionne hors ligne. |
| es   | Autobuses de Madeira: rutas, horarios, tarifas y avisos GPS. Sin conexión.       |
| it   | Autobus di Madeira: percorsi, orari, tariffe e avvisi GPS. Funziona offline.     |
| pl   | Autobusy na Maderze: trasy, rozkłady, ceny i alerty GPS. Działa offline.         |
| cs   | Autobusy na Madeiře: trasy, jízdní řády, ceny a GPS upozornění. Funguje offline. |
| ru   | Автобусы Мадейры: маршруты, расписания, цены и GPS-подсказки. Работает офлайн.   |

## Повний опис

Коли додамо розклади CAM і Rodoeste, приберіть останній абзац про них.

### English

Madeira by busses — explore Madeira with ease.

Plan door-to-door bus trips around Madeira on your phone, even without internet.

• Journeys with transfers: the best options by arrival time, number of changes and departure time, with the walk to and between stops.
• Real Horários do Funchal timetables with the line numbers shown on the bus since 2026; the old number is there too (110, formerly 10A).
• Scenic trips: Curral das Freiras, Eira do Serrado, Monte, the Botanical Garden, Pico dos Barcelos and more — photos, the route from the centre or from where you are, and every bus of the day there and back.
• Fares: SIGA 2026 tariffs, GIRO card or cash, and whether a day or tourist ticket pays off.
• The last bus back today, so you are never stuck in the mountains.
• GPS "when to get off": the app follows your bus, warns you before your stop and keeps going with the screen off and through tunnels.
• Line timetables from any stop on any date, and A4 timetables to print or share as PDF.
• Departures nearby, saved stops and recent trips.
• Map, satellite and terrain layers with 3D mountains.
• 10 languages: English, Português, Українська, Español, Français, Italiano, Deutsch, Čeština, Polski, Русский.
• Private by design: your location never leaves your phone. No account, no ads, no tracking.

Timetables of CAM, SIGA Rodoeste and Aerobus are coming next; until then the app says so plainly.

Madeira by busses is an independent app, not affiliated with SIGA, Horários do Funchal, CAM, Rodoeste or the Regional Government of Madeira. Timetables come from the operators' public data.

### Português

Madeira by busses — explore a Madeira com facilidade.

Planeie viagens de autocarro porta a porta na Madeira, no telemóvel, mesmo sem internet.

• Percursos com transbordos: as melhores opções por hora de chegada, número de transbordos e hora de partida, com o caminho a pé até às paragens.
• Horários reais dos Horários do Funchal, com os números de linha usados nos autocarros desde 2026; o número antigo também aparece (110, antiga 10A).
• Passeios com vista: Curral das Freiras, Eira do Serrado, Monte, Jardim Botânico, Pico dos Barcelos e mais — fotos, percurso a partir do centro ou de onde está, e todos os autocarros do dia, ida e volta.
• Tarifas SIGA 2026, cartão GIRO ou dinheiro, e se compensa o bilhete diário ou turístico.
• O último autocarro de regresso hoje.
• GPS «quando sair»: a app acompanha o autocarro, avisa antes da sua paragem e continua com o ecrã desligado e nos túneis.
• Horários das linhas a partir de qualquer paragem e em qualquer data, e horários A4 para imprimir ou partilhar em PDF.
• Partidas próximas, paragens guardadas e viagens recentes.
• Mapa, satélite e relevo com montanhas em 3D.
• 10 idiomas.
• Privacidade: a sua localização nunca sai do telemóvel. Sem conta, sem publicidade, sem rastreio.

Os horários da CAM, SIGA Rodoeste e Aerobus serão os próximos; até lá a app di-lo claramente.

O Madeira by busses é uma app independente, sem ligação à SIGA, Horários do Funchal, CAM, Rodoeste ou ao Governo Regional da Madeira. Os horários vêm dos dados públicos dos operadores.

### Українська

Madeira by busses — подорожуйте Мадейрою легко.

Плануйте поїздки автобусом Мадейрою «від дверей до дверей» на телефоні, навіть без інтернету.

• Маршрути з пересадками: найкращі варіанти за часом прибуття, кількістю пересадок і часом виходу, з пішим шляхом до зупинок.
• Справжній розклад Horários do Funchal з номерами ліній, що на автобусах із 2026 року; старий номер теж видно (110, раніше 10A).
• Краєвиди: Curral das Freiras, Eira do Serrado, Monte, Ботанічний сад, Pico dos Barcelos та інші — фото, маршрут від центру чи від вас і всі автобуси дня туди й назад.
• Ціни за тарифами SIGA 2026: картка GIRO чи готівка, і чи вигідний денний або туристичний квиток.
• Останній автобус назад сьогодні.
• GPS «коли виходити»: застосунок стежить за автобусом, попереджає перед вашою зупинкою і працює з вимкненим екраном і в тунелях.
• Розклад лінії від будь-якої зупинки на будь-яку дату й розклади A4 для друку чи надсилання в PDF.
• Відправлення поруч, збережені зупинки й нещодавні поїздки.
• Карта, супутник і рельєф із 3D-горами.
• 10 мов.
• Приватність: геопозиція не залишає телефон. Без облікового запису, реклами й стеження.

Розклади CAM, SIGA Rodoeste і Aerobus — наступні; доти застосунок прямо про це каже.

Madeira by busses — незалежний застосунок, не пов'язаний із SIGA, Horários do Funchal, CAM, Rodoeste чи урядом Мадейри. Розклади — з відкритих даних перевізників.
