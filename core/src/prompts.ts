import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

function msg(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

const PROJECT_LINE = (project?: string) =>
  project ? `Проект: ${project} (передавай project:"${project}" в инструменты).` : "Работай с активным проектом (yandex_projects_list покажет, какой активен).";

export function registerPrompts(server: McpServer): void {
  server.prompt(
    "campaign_audit",
    "Аудит кампаний Директа по методике автостратегий (CTR, отказы, поисковые запросы, структура)",
    { project: z.string().optional().describe("Project id") },
    ({ project }) =>
      msg(`Проведи аудит рекламных кампаний Яндекс Директа по методике автостратегий. ${PROJECT_LINE(project)}

Порядок (процедуры P1-P4 из плейбука yandex://playbook):
1. yandex_direct_campaigns_get (FieldNames: Id, Name, State, Status, DailyBudget, StatisticsFields) — структура и состояние кампаний. Проверь: Поиск и РСЯ не смешаны в одной кампании; нет общего лимита аккаунта.
2. yandex_direct_report (ReportType: CAMPAIGN_PERFORMANCE_REPORT, поля Impressions, Clicks, Ctr, Cost, Conversions, DateRangeType: LAST_14_DAYS) — расход и конверсии.
3. Для Поисковых кампаний: CTR ≥ 10% — норма; 5-8% — плохо; 2-3% — автотаргет не понял аудиторию, нужны новые заголовки. Проверь CTR и на уровне групп (ADGROUP_PERFORMANCE_REPORT).
4. Для Поисковых кампаний на автотаргете: SEARCH_QUERY_PERFORMANCE_REPORT — по каким запросам показывается реклама. Ищи «зацепки за буквальное слово» (алгоритм цепляется за одно слово заголовка и строит нецелевую аудиторию). Это окно в мозг алгоритма — выводы экстраполируй на РСЯ.
5. Для РСЯ: yandex_metrika_stat_bytime (metrics: ym:s:bounceRate,ym:s:visits, group: day, за 14 дней) — динамика отказов. Норма ~20%; старт с 60% и снижение по дням = обучение идёт; нет снижения 3-4 дня = менять заголовки, не бюджеты.
6. Сверь число конверсий за неделю с порогом обучения: минимум 10 конверсий/нед на кампанию (M1).

Формат ответа: таблица кампаний (тип, состояние, расход, конверсии, CPA, CTR/отказы, статус обучения) → диагнозы по каждой проблемной кампании → конкретные действия, отсортированные по влиянию. Не предлагай отключать объявления/группы внутри обучающихся кампаний (M6).`)
  );

  server.prompt(
    "weekly_report",
    "Еженедельный отчёт: расход → конверсии → CPA → окупаемость по всем каналам",
    { project: z.string().optional().describe("Project id") },
    ({ project }) =>
      msg(`Собери еженедельный отчёт по трафику и рекламе. ${PROJECT_LINE(project)}

1. Расход Директа: yandex_direct_report (ACCOUNT_PERFORMANCE_REPORT или CAMPAIGN_PERFORMANCE_REPORT, LAST_WEEK и предыдущая неделя для сравнения).
2. Трафик и конверсии: yandex_metrika_stat_data (metrics: ym:s:visits,ym:s:users,ym:s:goal<ID>reaches — сначала возьми ID целей через yandex_metrika_goals_list; dimensions: ym:s:lastTrafficSource) — по источникам.
3. Динамика: yandex_metrika_stat_bytime по дням за 2 недели (visits, bounceRate, конверсии).
4. Если загружались расходы других каналов (yandex_metrika_expenses_uploadings) — включи их в сравнение каналов.
5. SEO-блок: yandex_webmaster_summary_get + yandex_webmaster_query_analytics (топ запросов, динамика показов/кликов).

Формат: сводка недели (расход, лиды, CPA, динамика к прошлой неделе) → разбивка по каналам → 3 главных вывода → рекомендации (масштабировать по лестнице §4 плейбука / ждать обучения / чинить). Помни: значимые изменения бюджета только пн-чт (M3), рост CPA при масштабировании — норма.`)
  );

  server.prompt(
    "launch_campaign",
    "Пошаговый запуск РСЯ-кампании на автотаргете по методике (структура, стратегия, цель)",
    {
      product: z.string().describe("Что рекламируем (продукт/оффер)"),
      weekly_budget: z.string().describe("Недельный бюджет, руб."),
      landing_url: z.string().optional().describe("URL посадочной страницы"),
    },
    ({ product, weekly_budget, landing_url }) =>
      msg(`Подготовь запуск рекламы в Яндекс Директе на автостратегиях по методике из yandex://playbook.

Продукт: ${product}. Недельный бюджет: ${weekly_budget} руб.${landing_url ? ` Посадочная: ${landing_url}` : ""}

Шаги:
1. Цель (60% успеха, P5): yandex_metrika_goals_list — выбери КОНЕЧНУЮ цель воронки (thank-you page, старт бота). Не клики по кнопкам, не созависимые цели. Если правильной цели нет — предложи создать через yandex_metrika_goal_add (preview покажет, что именно).
2. Проверь порог обучения: бюджет / ожидаемый CPA ≥ 10 конверсий в неделю (M1). Если не проходит — предложи сузить до 2-3 самых уверенных групп, но НЕ менять цель на промежуточную.
3. Структура: кампании по ${weekly_budget} руб... раздели на 2-3 кампании по 3-5 групп, если бюджет позволяет ≥10 конверсий каждой. Одна группа = одна гипотеза посыла (H4). Извлеки сегменты и словоформы с посадочной страницы, не из фантазий о ЦА (§6 плейбука).
4. Стратегия: Максимум конверсий, ОПЛАТА ЗА КЛИКИ, ограничение только недельным бюджетом (H1). РСЯ и Поиск — раздельными кампаниями (M11); диагностическую поисковую кампанию на автотаргете ~3000 руб/нед предложи отдельно (H11).
5. Заголовки: контентное слово (нацеливает автотаргет — 80% сигнала, M13) + маркетинговое украшение. 3-5 объявлений на группу (H3). Title посадочной должен быть осмысленным.
6. Собери всё через yandex_direct_campaigns_manage → adgroups_manage → ads_manage (+ sitelinks/adextensions один раз на кампанию) В РЕЖИМЕ PREVIEW (без confirm). Покажи полную структуру на подтверждение, применяй только после моего согласия.
7. Напомни правило выходных: не запускать пт-вс (M3); при запуске в конце недели — половина бюджета, добор в понедельник.`)
  );

  server.prompt(
    "scale_budget",
    "Масштабирование бюджета кампании по лестнице с guardrails",
    {
      campaign_id: z.string().describe("Id кампании в Директе"),
      target_budget: z.string().describe("Целевой недельный бюджет, руб."),
    },
    ({ campaign_id, target_budget }) =>
      msg(`Масштабируй бюджет кампании ${campaign_id} до ${target_budget} руб/нед по лестнице из плейбука (§4).

1. Текущее состояние: yandex_direct_campaigns_get (Id: ${campaign_id}; DailyBudget/WeeklySpendLimit, State) + CAMPAIGN_PERFORMANCE_REPORT за 14 дней (конверсии, CPA по дням).
2. Проверь готовность: кампания обучена (≥10 конверсий/нед, стабильный CPA)? Если нет — масштабировать рано, объясни почему.
3. Лестница: шаг ×1.5-2, наблюдение 2-3 дня на ступени. Рассчитай ступени от текущего до ${target_budget} и предложи только ПЕРВУЮ ступень сейчас.
4. Примени через yandex_direct_campaigns_manage с money_deltas (kind: budget) — сработают лимиты проекта и правило выходных (пн-чт). Сначала preview, потом confirm после моего согласия.
5. Предупреди: после подъёма кампанию «трясёт» 1-2 дня; рост CPA при масштабировании — норма (бюджет ×20 может дать CPA ×3), критерий — окупаемость.`)
  );

  server.prompt(
    "seo_audit",
    "SEO-аудит сайта через Вебмастер (индексация, запросы, диагностика, ссылки)",
    { host_id: z.string().optional().describe("Host ID, например https:site.ru:443") },
    ({ host_id }) =>
      msg(`Проведи SEO-аудит сайта через Яндекс Вебмастер.${host_id ? ` Host: ${host_id}.` : " Возьми хост из yandex_webmaster_hosts_list."}

1. yandex_webmaster_summary_get — SQI, страницы в поиске, исключённые, проблемы.
2. yandex_webmaster_diagnostics_get — фатальные/критичные/возможные проблемы.
3. yandex_webmaster_query_analytics (text_indicator: QUERY, потом URL) — топ запросов и страниц за 2 недели: показы, клики, CTR, позиция. Найди запросы с показами но низким CTR (< 2% на позициях 1-10 = слабые сниппеты) и страницы, теряющие трафик.
4. yandex_webmaster_indexing_history + search_urls_events_history — динамика индексации, выпавшие из поиска страницы и причины.
5. yandex_webmaster_sitemaps_list — актуальность sitemap.
6. yandex_webmaster_links_external_history — динамика ссылочной массы.

Формат: здоровье сайта (ок/проблемы) → находки по убыванию влияния на трафик → конкретные действия (что переобойти через recrawl_submit, какие страницы чинить, какие запросы усиливать). Мониторинг запросов держит данные только 2 недели — если аудит регулярный, сравни с прошлым отчётом.`)
  );

  server.prompt(
    "learning_check",
    "Контроль обучения кампаний: не мешаем алгоритму, ловим проблемы рано (P2/P3)",
    { project: z.string().optional().describe("Project id") },
    ({ project }) =>
      msg(`Проверь, как обучаются кампании Директа — рано ловим проблемы, не мешая алгоритму. ${PROJECT_LINE(project)}

1. yandex_direct_campaigns_get — активные кампании и их возраст/состояние.
2. Для Поиска (P2): CAMPAIGN_PERFORMANCE_REPORT c Ctr по дням. CTR < 10% = менять заголовки; смотри тренд, не среднее.
3. Для РСЯ (P3): yandex_metrika_stat_bytime (ym:s:bounceRate по дням с запуска, фильтр по UTM кампании если размечено). День 1: ~60% — норма. Здоровое обучение = монотонное снижение к ~20%. Нет снижения 3-4 дня = аудитория подобрана неверно.
4. Первые дни дорогие лиды — это НОРМА (M5): день 1-2 CPA может быть в разы выше целевого, день 5-7 — выход на плато. Не предлагай останавливать кампании младше 7 дней с положительной динамикой.
5. Если динамики нет: диагноз через SEARCH_QUERY_PERFORMANCE_REPORT поисковой кампании (как Яндекс понял аудиторию) → рекомендация менять КОНТЕНТНОЕ СЛОВО заголовка, не бюджет и не площадки (площадки не чистим, H7/M6).

Формат: по каждой кампании — фаза (обучается/обучена/застряла), динамика ключевой метрики по дням, вердикт: ждать / менять заголовки / готова к масштабированию.`)
  );

  // The playbook as an MCP resource: any client connecting to this server can
  // pull the methodology into context without having the repo checked out.
  server.resource(
    "autostrategies-playbook",
    "yandex://playbook",
    { description: "Плейбук: Яндекс Директ на автостратегиях — механика платформы, эвристики, процедуры P1-P5, лестница масштабирования", mimeType: "text/markdown" },
    async () => {
      let text: string;
      try {
        const path = fileURLToPath(new URL("../docs/playbook-autostrategies.md", import.meta.url));
        text = readFileSync(path, "utf8");
      } catch {
        text = "Playbook file not found (docs/playbook-autostrategies.md). See README.";
      }
      return { contents: [{ uri: "yandex://playbook", mimeType: "text/markdown", text }] };
    }
  );
}
