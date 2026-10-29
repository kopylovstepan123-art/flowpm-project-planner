(function () {
  "use strict";

  const STORAGE_KEY = "flowpm_ru_local_v1";
  const STATUSES = ["Backlog", "To Do", "In Progress", "Done"];
  const PRIORITIES = ["Low", "Medium", "High", "Critical"];
  const TYPES = ["Task", "Milestone", "Risk"];
  const RELATIONS = ["depends_on", "blocks", "related"];
  const VALID_COLORS = ["red", "yellow", "green", "gray", "blue", "purple", "orange"];
  const MAX_PROJECTS = 80;
  const MAX_TASKS = 1200;
  const MAX_RELATIONS = 2500;
  const MAX_INBOX = 500;
  const MAX_TITLE_LENGTH = 120;
  const MAX_DESCRIPTION_LENGTH = 1500;
  const MAX_LONG_TEXT_LENGTH = 4000;
  const MAX_CHECKLIST_ITEMS = 30;
  const MAX_FILE_SIZE_BYTES = 1.5 * 1024 * 1024;
  const RELATION_LABEL = {
    depends_on: "Зависит от",
    blocks: "Блокирует",
    related: "Связано с"
  };

  const STATUS_LABEL = {
    Backlog: "Бэклог",
    "To Do": "К выполнению",
    "In Progress": "В работе",
    Done: "Готово"
  };

  const PRIORITY_LABEL = {
    Low: "Низкий",
    Medium: "Средний",
    High: "Высокий",
    Critical: "Критический"
  };

  const TYPE_LABEL = {
    Task: "Задача",
    Milestone: "Веха",
    Risk: "Риск"
  };

  function statusLabel(value) { return STATUS_LABEL[value] || value; }
  function priorityLabel(value) { return PRIORITY_LABEL[value] || value; }
  function typeLabel(value) { return TYPE_LABEL[value] || value; }
  function optionLabel(value) { return statusLabel(priorityLabel(typeLabel(value))); }
  function calendarStatusClass(status) {
    return {
      Backlog: "backlog",
      "To Do": "todo",
      "In Progress": "progress",
      Done: "done"
    }[status] || "backlog";
  }

  let state = loadState();
  let ui = {
    page: "dashboard",
    projectId: null,
    tab: "list",
    calendarDate: new Date(),
    selectedCalendarDate: todayISO(),
    filterStatus: "all",
    filterPriority: "all",
    filterType: "all",
    quickFilter: "all",
    dashboardFilter: "all",
    pendingAiResult: null,
    currentAiProjectId: null,
    nodePanelCollapsed: false,
    nodeMapFullscreen: false
  };

  const $ = (id) => document.getElementById(id);
  const content = $("content");
  const pageTitle = $("pageTitle");
  const pageSubtitle = $("pageSubtitle");
  const sidebar = $("sidebar");
  const overlay = $("overlay");
  const drawer = $("taskDrawer");
  const toast = $("toast");

  document.addEventListener("DOMContentLoaded", init);
  if (document.readyState !== "loading") init();

  function init() {
    bindGlobalEvents();
    ensureUsableState();
    render();
  }

  function defaultState() {
    return {
      projects: [],
      tasks: [],
      relations: [],
      inbox: [],
      settings: { workspaceName: "Локальное рабочее пространство", aiApiKey: "", aiModel: "gpt-4o-mini" },
      onboardingDone: false
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      if (raw.length > MAX_FILE_SIZE_BYTES * 2) throw new Error("Локальное хранилище слишком большое");
      const parsed = JSON.parse(raw);
      return sanitizeState(parsed);
    } catch (error) {
      console.warn("FlowPM: failed to load local data", error);
      try { localStorage.setItem(`${STORAGE_KEY}_broken_backup_${Date.now()}`, localStorage.getItem(STORAGE_KEY) || ""); } catch (e) {}
      return defaultState();
    }
  }

  function saveState() {
    try {
      state = sanitizeState(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("FlowPM: failed to save local data", error);
      try { showToast("Не удалось сохранить данные: хранилище браузера переполнено или недоступно"); }
      catch (e) { alert("Не удалось сохранить данные в браузере."); }
    }
  }

  function ensureUsableState() {
    state = sanitizeState(state);
    saveState();
  }

  function uid(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }


  function safeText(value, maxLength = MAX_DESCRIPTION_LENGTH) {
    let text = String(value ?? "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
      .replace(/[ \t]{3,}/g, "  ")
      .trim();
    if (text.length > maxLength) text = text.slice(0, maxLength).trim();
    return text;
  }

  function safeTitle(value, fallback = "Без названия") {
    return safeText(value, MAX_TITLE_LENGTH) || fallback;
  }

  function safeCssClass(value) {
    return String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  }

  function isPlainId(value) {
    return /^[a-zA-Z0-9_-]{1,90}$/.test(String(value || ""));
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function normalizeDate(value) {
    const iso = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
    const [year, month, day] = iso.split("-").map(Number);
    if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return "";
    const date = new Date(year, month - 1, day);
    return toISO(date) === iso ? iso : "";
  }

  function normalizeColor(value) {
    return VALID_COLORS.includes(value) ? value : "gray";
  }

  function sanitizeChecklist(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => safeText(item, 180))
      .filter(Boolean)
      .slice(0, MAX_CHECKLIST_ITEMS);
  }

  function sanitizeSettings(settings = {}) {
    const model = safeText(settings.aiModel || "gpt-4o-mini", 80);
    return {
      workspaceName: safeTitle(settings.workspaceName || "Локальное рабочее пространство", "Локальное рабочее пространство"),
      aiApiKey: "",
      aiModel: /^[a-zA-Z0-9_.:-]{1,80}$/.test(model) ? model : "gpt-4o-mini"
    };
  }

  function sanitizeState(input = {}) {
    const base = defaultState();
    const clean = {
      ...base,
      projects: [],
      tasks: [],
      relations: [],
      inbox: [],
      settings: sanitizeSettings(input.settings || {}),
      onboardingDone: Boolean(input.onboardingDone)
    };

    const projectIdMap = new Map();
    const usedProjectIds = new Set();
    const rawProjects = Array.isArray(input.projects) ? input.projects.slice(0, MAX_PROJECTS) : [];
    rawProjects.forEach((project) => {
      const oldId = String(project?.id || "");
      const id = isPlainId(oldId) && !usedProjectIds.has(oldId) ? oldId : uid("project");
      usedProjectIds.add(id);
      if (oldId) projectIdMap.set(oldId, id);
      clean.projects.push({
        id,
        name: safeTitle(project?.name, "Новый проект"),
        description: safeText(project?.description, MAX_DESCRIPTION_LENGTH),
        createdAt: safeText(project?.createdAt, 40) || new Date().toISOString(),
        updatedAt: safeText(project?.updatedAt, 40) || new Date().toISOString()
      });
    });

    const taskIdMap = new Map();
    const usedTaskIds = new Set();
    const rawTasks = Array.isArray(input.tasks) ? input.tasks.slice(0, MAX_TASKS) : [];
    rawTasks.forEach((task) => {
      const mappedProjectId = projectIdMap.get(String(task?.projectId || "")) || String(task?.projectId || "");
      if (!clean.projects.some((project) => project.id === mappedProjectId)) return;
      const oldId = String(task?.id || "");
      const id = isPlainId(oldId) && !usedTaskIds.has(oldId) ? oldId : uid("task");
      usedTaskIds.add(id);
      if (oldId) taskIdMap.set(oldId, id);
      const status = normalizeStatus(task?.status);
      clean.tasks.push({
        id,
        projectId: mappedProjectId,
        title: safeTitle(task?.title, "Новая задача"),
        description: safeText(task?.description, MAX_DESCRIPTION_LENGTH),
        status,
        priority: normalizePriority(task?.priority),
        type: normalizeType(task?.type),
        startDate: normalizeDate(task?.startDate),
        dueDate: normalizeDate(task?.dueDate),
        color: normalizeColor(task?.color || colorByStatus(status)),
        checklist: sanitizeChecklist(task?.checklist),
        notes: safeText(task?.notes, MAX_LONG_TEXT_LENGTH),
        positionX: clampNumber(task?.positionX, 0, 5000, 70),
        positionY: clampNumber(task?.positionY, 0, 5000, 70),
        createdAt: safeText(task?.createdAt, 40) || new Date().toISOString(),
        updatedAt: safeText(task?.updatedAt, 40) || new Date().toISOString()
      });
    });

    const relationKeys = new Set();
    const rawRelations = Array.isArray(input.relations) ? input.relations.slice(0, MAX_RELATIONS) : [];
    rawRelations.forEach((rel) => {
      const projectId = projectIdMap.get(String(rel?.projectId || "")) || String(rel?.projectId || "");
      const sourceTaskId = taskIdMap.get(String(rel?.sourceTaskId || "")) || String(rel?.sourceTaskId || "");
      const targetTaskId = taskIdMap.get(String(rel?.targetTaskId || "")) || String(rel?.targetTaskId || "");
      if (!clean.projects.some((project) => project.id === projectId)) return;
      if (!clean.tasks.some((task) => task.id === sourceTaskId) || !clean.tasks.some((task) => task.id === targetTaskId)) return;
      if (sourceTaskId === targetTaskId) return;
      const relationType = normalizeRelationType(rel?.relationType);
      const key = `${projectId}|${sourceTaskId}|${targetTaskId}|${relationType}`;
      if (relationKeys.has(key)) return;
      relationKeys.add(key);
      clean.relations.push({
        id: isPlainId(rel?.id) ? String(rel.id) : uid("rel"),
        projectId,
        sourceTaskId,
        targetTaskId,
        relationType,
        createdAt: safeText(rel?.createdAt, 40) || new Date().toISOString()
      });
    });

    const rawInbox = Array.isArray(input.inbox) ? input.inbox.slice(0, MAX_INBOX) : [];
    clean.inbox = rawInbox.map((item) => ({
      id: isPlainId(item?.id) ? String(item.id) : uid("inbox"),
      title: safeTitle(item?.title, "Новая задача"),
      createdAt: safeText(item?.createdAt, 40) || new Date().toISOString()
    })).filter((item) => item.title);

    return clean;
  }

  function todayISO() {
    return toISO(new Date());
  }

  function toISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function fromISO(iso) {
    const normalized = normalizeDate(iso);
    if (!normalized) return null;
    const parts = normalized.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function formatDate(iso) {
    if (!iso) return "Без даты";
    const date = fromISO(iso);
    if (!date) return "Без даты";
    return date.toLocaleDateString("ru-RU", { month: "short", day: "numeric", year: "numeric" });
  }

  function dateAdd(days) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + days);
    return toISO(date);
  }

  function getProject(id) {
    return state.projects.find((project) => project.id === id) || null;
  }

  function getTask(id) {
    return state.tasks.find((task) => task.id === id) || null;
  }

  function projectTasks(projectId) {
    return state.tasks.filter((task) => task.projectId === projectId);
  }

  function isDone(task) {
    return task && task.status === "Done";
  }

  function isBlocked(task) {
    if (!task) return false;
    return state.relations.some((rel) => {
      const source = getTask(rel.sourceTaskId);
      const targetMatch = rel.targetTaskId === task.id;
      const blocksMatch = rel.relationType === "blocks" && rel.sourceTaskId !== task.id && rel.targetTaskId === task.id;
      const dependsMatch = rel.relationType === "depends_on" && targetMatch;
      return (dependsMatch || blocksMatch) && source && !isDone(source);
    });
  }

  function isOverdue(task) {
    return task && task.dueDate && task.dueDate < todayISO() && task.status !== "Done";
  }

  function isUpcoming(task) {
    return task && task.dueDate && task.dueDate >= todayISO() && task.dueDate <= dateAdd(7) && task.status !== "Done";
  }

  function matchesQuickFilter(task, filterMode = ui.quickFilter) {
    if (!task) return false;
    if (!filterMode || filterMode === "all") return true;
    if (filterMode === "today") return task.dueDate === todayISO() && task.status !== "Done";
    if (filterMode === "overdue") return isOverdue(task);
    if (filterMode === "blocked") return isBlocked(task);
    if (filterMode === "upcoming") return isUpcoming(task);
    if (filterMode === "available") return availableToStart(task);
    if (filterMode === "todo") return task.status === "To Do";
    if (filterMode === "progress") return task.status === "In Progress";
    if (filterMode === "done") return task.status === "Done";
    if (filterMode === "backlog") return task.status === "Backlog";
    return true;
  }

  function quickFilterLabel(filterMode = ui.quickFilter) {
    return {
      all: "Все задачи проекта",
      today: "Задачи на сегодня",
      overdue: "Просроченные задачи",
      blocked: "Заблокированные задачи",
      upcoming: "Задачи на ближайшие 7 дней",
      available: "Следующие доступные задачи",
      todo: "К выполнению",
      progress: "В работе",
      done: "Готово",
      backlog: "Бэклог"
    }[filterMode] || "Отфильтрованные задачи";
  }

  function tasksByQuickFilter(tasks, filterMode = ui.quickFilter) {
    return tasks.filter((task) => matchesQuickFilter(task, filterMode));
  }

  function availableToStart(task) {
    return task && task.status !== "Done" && !isBlocked(task);
  }

  function progressForProject(projectId) {
    const tasks = projectTasks(projectId);
    if (!tasks.length) return 0;
    return Math.round((tasks.filter((task) => task.status === "Done").length / tasks.length) * 100);
  }

  function badge(value, extra = "") {
    const safe = safeCssClass(value);
    const extraClasses = String(extra || "").split(/\s+/).map(safeCssClass).filter(Boolean).join(" ");
    return `<span class="badge ${safe} ${extraClasses}">${esc(value)}</span>`;
  }

  function render() {
    try {
      $("workspaceLabel").textContent = state.settings.workspaceName || "Локальное рабочее пространство";
      updateNav();
      const titles = {
        dashboard: ["Панель", "Локальный центр управления проектами"],
        projects: ["Проекты", "Создание и управление локальными проектами"],
        calendar: ["Календарь", "Планирование задач по датам"],
        inbox: ["Входящие", "Быстрый сбор несортированных задач"],
        settings: ["Настройки", "Локальные данные, экспорт и импорт"],
        project: [getProject(ui.projectId)?.name || "Проект", "Трекер задач, ноды и календарь"]
      };
      const [title, subtitle] = titles[ui.page] || titles.dashboard;
      pageTitle.textContent = title;
      pageSubtitle.textContent = subtitle;

      if (ui.page === "dashboard") renderDashboard();
      else if (ui.page === "projects") renderProjects();
      else if (ui.page === "calendar") renderGlobalCalendar();
      else if (ui.page === "inbox") renderInbox();
      else if (ui.page === "settings") renderSettings();
      else if (ui.page === "project") renderProjectWorkspace();
      else renderDashboard();
    } catch (error) {
      console.error("FlowPM render error", error);
      content.innerHTML = `<div class="empty"><h2>Что-то пошло не так</h2><p>Приложение не смогло отобразить этот экран. Попробуйте сбросить локальные данные в браузере или перезагрузить страницу.</p><button class="btn danger" id="hardResetBtn">Сбросить локальные данные</button></div>`;
      const btn = $("hardResetBtn");
      if (btn) btn.addEventListener("click", resetData);
    }
  }

  function updateNav() {
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.page === ui.page);
    });
  }

  function setPage(page) {
    ui.page = page;
    if (page !== "project") ui.projectId = ui.projectId;
    if (page !== "dashboard") ui.dashboardFilter = "all";
    if (page !== "project") ui.quickFilter = "all";
    sidebar.classList.remove("open");
    render();
  }

  function renderDashboard() {
    const allTasks = state.tasks;
    const todayTasks = allTasks.filter((task) => task.dueDate === todayISO() && task.status !== "Done");
    const overdue = allTasks.filter(isOverdue);
    const blocked = allTasks.filter(isBlocked);
    const upcoming = allTasks.filter(isUpcoming);

    const welcome = !state.onboardingDone && state.projects.length === 0 ? `
      <section class="hero">
        <div class="card">
          <p class="eyebrow">Добро пожаловать в FlowPM</p>
          <h2>Планируйте проекты через задачи, ноды и календарь.</h2>
          <p>FlowPM — простой локальный планировщик проектов. Без входа, сервера и синхронизации. Всё хранится только в этом браузере.</p>
          <div class="hero-actions">
            <button class="btn primary" id="createFirstProjectBtn">Создать первый проект</button>
            <button class="btn secondary" id="loadDemoWelcomeBtn">Загрузить демо-проект</button>
            <button class="btn secondary" id="skipWelcomeBtn">Пропустить</button>
          </div>
        </div>
        <div class="card mini-guide">
          <div class="guide-step"><strong>1. Создайте проект</strong><span>Соберите работу в понятный контейнер.</span></div>
          <div class="guide-step"><strong>2. Добавьте задачи</strong><span>Отслеживайте статус, приоритет и дедлайн.</span></div>
          <div class="guide-step"><strong>3. Свяжите ноды</strong><span>Увидьте, что от чего зависит.</span></div>
          <div class="guide-step"><strong>4. Планируйте в календаре</strong><span>Превратите задачи в план на неделю.</span></div>
        </div>
      </section>
    ` : "";

    content.innerHTML = `
      ${welcome}
      <div class="stats">
        <button class="stat stat-click dashboard-filter" data-filter="today"><span>Сегодня</span><strong>${todayTasks.length}</strong><small>Открыть список</small></button>
        <button class="stat stat-click dashboard-filter" data-filter="overdue"><span>Просрочено</span><strong>${overdue.length}</strong><small>Открыть список</small></button>
        <button class="stat stat-click dashboard-filter" data-filter="blocked"><span>Заблокировано</span><strong>${blocked.length}</strong><small>Открыть список</small></button>
        <button class="stat stat-click dashboard-filter" data-filter="upcoming"><span>Ближайшие 7 дней</span><strong>${upcoming.length}</strong><small>Открыть список</small></button>
      </div>
      ${renderDashboardFilterPanel()}
      <div class="grid">
        <section class="panel">
          <div class="toolbar"><h3>Активные проекты</h3><button class="btn small primary" id="dashNewProjectBtn">Новый проект</button></div>
          ${state.projects.length ? `<div class="grid-3">${state.projects.map(projectCard).join("")}</div>` : emptyState("Проектов пока нет", "Создайте первый проект или загрузите демо-данные, чтобы начать планирование.")}
        </section>
        <section class="panel">
          <h3>Следующие доступные задачи</h3>
          ${renderCompactTasks(allTasks.filter(availableToStart).slice(0, 8))}
        </section>
      </div>
    `;

    bindProjectCards();
    bindTaskLinks();
    bindQuickFilters();
    bindOptional("createFirstProjectBtn", createProjectPrompt);
    bindOptional("loadDemoWelcomeBtn", loadDemoData);
    bindOptional("skipWelcomeBtn", () => { state.onboardingDone = true; saveState(); render(); });
    bindOptional("dashNewProjectBtn", createProjectPrompt);
  }

  function renderDashboardFilterPanel() {
    if (!ui.dashboardFilter || ui.dashboardFilter === "all") return "";
    const matchingTasks = tasksByQuickFilter(state.tasks, ui.dashboardFilter);
    const groupedProjects = state.projects
      .map((project) => ({ project, tasks: matchingTasks.filter((task) => task.projectId === project.id) }))
      .filter((item) => item.tasks.length);

    if (!groupedProjects.length) {
      return `
        <section class="panel filter-panel">
          <div class="toolbar">
            <div><h3>${esc(quickFilterLabel(ui.dashboardFilter))}</h3><p class="task-sub">По этому фильтру задач пока нет.</p></div>
            <button class="btn small secondary clear-dashboard-filter">Скрыть</button>
          </div>
        </section>
      `;
    }

    return `
      <section class="panel filter-panel">
        <div class="toolbar">
          <div>
            <h3>${esc(quickFilterLabel(ui.dashboardFilter))}</h3>
            <p class="task-sub">Выберите проект, чтобы сразу открыть нужный список задач.</p>
          </div>
          <button class="btn small secondary clear-dashboard-filter">Скрыть</button>
        </div>
        <div class="task-list">
          ${groupedProjects.map(({ project, tasks }) => `
            <div class="task-row task-row-filter">
              <div>
                <div class="task-title">${esc(project.name)}</div>
                <div class="task-sub">${tasks.length} задач · ${tasks.slice(0, 3).map((task) => esc(task.title)).join(", ")}${tasks.length > 3 ? "…" : ""}</div>
              </div>
              <div>${badge(`${tasks.length} задач`)}</div>
              <div><button class="btn small primary open-project-filter" data-project-id="${project.id}" data-filter="${ui.dashboardFilter}">Открыть список</button></div>
            </div>
          `).join("")}
        </div>
      </section>
    `;
  }

  function quickBadge(label, projectId, filter, extra = "") {
    return `<button class="badge badge-action ${extra}" data-project-id="${projectId}" data-filter="${filter}">${esc(label)}</button>`;
  }

  function projectCard(project) {
    const tasks = projectTasks(project.id);
    const progress = progressForProject(project.id);
    const blocked = tasks.filter(isBlocked).length;
    const overdue = tasks.filter(isOverdue).length;
    const todo = tasks.filter((task) => task.status === "To Do").length;
    const inProgress = tasks.filter((task) => task.status === "In Progress").length;
    const done = tasks.filter((task) => task.status === "Done").length;
    return `
      <article class="card project-card">
        <div>
          <h3>${esc(project.name)}</h3>
          <p>${esc(project.description || "Без описания")}</p>
        </div>
        <div class="progress"><span style="width:${progress}%"></span></div>
        <div class="meta-row">
          ${quickBadge(`${tasks.length} задач`, project.id, "all")}
          ${todo ? quickBadge(`${todo} к выполнению`, project.id, "todo", "todo-filter") : ""}
          ${inProgress ? quickBadge(`${inProgress} в работе`, project.id, "progress", "progress-filter") : ""}
          ${done ? quickBadge(`${done} готово`, project.id, "done", "done-filter") : ""}
          ${blocked ? quickBadge(`${blocked} заблокировано`, project.id, "blocked", "blocked") : ""}
          ${overdue ? quickBadge(`${overdue} просрочено`, project.id, "overdue", "overdue") : ""}
        </div>
        <div class="meta-row">
          <button class="btn small primary open-project" data-project-id="${project.id}">Открыть</button>
          <button class="btn small edit-project" data-project-id="${project.id}">Изменить</button>
          <button class="btn small danger delete-project" data-project-id="${project.id}">Удалить</button>
        </div>
      </article>
    `;
  }

  function renderProjects() {
    content.innerHTML = `
      <div class="toolbar">
        <div><h2>Проекты</h2><p class="task-sub">Создавайте отдельное локальное пространство для каждого проекта.</p></div>
        <button class="btn primary" id="newProjectBtn">Новый проект</button>
      </div>
      ${state.projects.length ? `<div class="grid-3">${state.projects.map(projectCard).join("")}</div>` : emptyState("Проектов пока нет", "Создайте первый проект или загрузите демо-проект.")}
    `;
    bindOptional("newProjectBtn", createProjectPrompt);
    bindProjectCards();
    bindQuickFilters();
  }

  function renderProjectWorkspace() {
    const project = getProject(ui.projectId) || state.projects[0];
    if (!project) {
      ui.page = "projects";
      renderProjects();
      return;
    }
    ui.projectId = project.id;
    const progress = progressForProject(project.id);
    content.innerHTML = `
      <section class="panel">
        <div class="toolbar">
          <div>
            <h2>${esc(project.name)}</h2>
            <p>${esc(project.description || "Без описания")}</p>
          </div>
          <div class="toolbar-right">
            <button class="btn secondary" id="backToProjectsBtn">Назад к проектам</button>
            <button class="btn secondary" id="projectAiPlannerBtn">AI: создать задачи</button>
            <button class="btn primary" id="projectNewTaskBtn">Новая задача</button>
          </div>
        </div>
        <div class="progress"><span style="width:${progress}%"></span></div>
        ${ui.quickFilter !== "all" ? `<div class="active-filter"><span>Открыт список: <strong>${esc(quickFilterLabel())}</strong></span><button class="btn small secondary clear-quick-filter">Показать все задачи</button></div>` : ""}
        <div class="tabs">
          ${["list", "board", "nodes", "calendar"].map(tab => `<button class="tab-btn ${ui.tab === tab ? "active" : ""}" data-tab="${tab}">${tabLabel(tab)}</button>`).join("")}
        </div>
        <div id="projectView"></div>
      </section>
    `;
    bindOptional("backToProjectsBtn", () => setPage("projects"));
    bindOptional("projectNewTaskBtn", () => openTaskDrawer(null, project.id));
    bindOptional("projectAiPlannerBtn", () => openAiPlannerModal(project.id));
    document.querySelectorAll(".tab-btn").forEach((btn) => btn.addEventListener("click", () => { ui.tab = btn.dataset.tab; renderProjectWorkspace(); }));
    document.querySelectorAll(".clear-quick-filter").forEach((btn) => btn.addEventListener("click", () => { ui.quickFilter = "all"; ui.filterStatus = "all"; ui.filterPriority = "all"; ui.filterType = "all"; renderProjectWorkspace(); }));

    if (ui.tab === "list") renderListView(project.id);
    if (ui.tab === "board") renderBoardView(project.id);
    if (ui.tab === "nodes") renderNodeView(project.id);
    if (ui.tab === "calendar") renderCalendarView(project.id);
  }

  function tabLabel(tab) {
    return { list: "Список", board: "Доска", nodes: "Карта нод", calendar: "Календарь" }[tab] || tab;
  }

  function renderListView(projectId) {
    const root = $("projectView");
    const tasks = filteredTasks(projectTasks(projectId));
    root.innerHTML = `
      ${ui.quickFilter !== "all" ? `<div class="filter-note"><strong>${esc(quickFilterLabel())}</strong><span>${tasks.length} задач в списке</span></div>` : ""}
      <div class="toolbar">
        <div class="toolbar-left">
          <select id="filterStatus"><option value="all">Все статусы</option>${STATUSES.map(x => `<option value="${x}" ${ui.filterStatus === x ? "selected" : ""}>${statusLabel(x)}</option>`).join("")}</select>
          <select id="filterPriority"><option value="all">Все приоритеты</option>${PRIORITIES.map(x => `<option value="${x}" ${ui.filterPriority === x ? "selected" : ""}>${priorityLabel(x)}</option>`).join("")}</select>
          <select id="filterType"><option value="all">Все типы</option>${TYPES.map(x => `<option value="${x}" ${ui.filterType === x ? "selected" : ""}>${typeLabel(x)}</option>`).join("")}</select>
        </div>
      </div>
      ${tasks.length ? `<div class="task-list">${tasks.map(taskRow).join("")}</div>` : emptyState("В этом представлении нет задач", "Создайте задачу или измените фильтры.")}
    `;
    ["filterStatus", "filterPriority", "filterType"].forEach((id) => {
      bindOptional(id, (event) => { ui[id] = event.target.value; renderListView(projectId); }, "change");
    });
    bindTaskLinks();
  }

  function filteredTasks(tasks) {
    return tasks.filter((task) => {
      if (!matchesQuickFilter(task, ui.quickFilter)) return false;
      if (ui.filterStatus !== "all" && task.status !== ui.filterStatus) return false;
      if (ui.filterPriority !== "all" && task.priority !== ui.filterPriority) return false;
      if (ui.filterType !== "all" && task.type !== ui.filterType) return false;
      return true;
    });
  }

  function taskRow(task) {
    return `
      <div class="task-row">
        <div><div class="task-title">${esc(task.title)}</div><div class="task-sub">${esc(task.description || "Без описания")}</div></div>
        <div>${badge(statusLabel(task.status), task.status.replace(/\s+/g, ""))}</div>
        <div>${badge(priorityLabel(task.priority), task.priority)}</div>
        <div>${badge(typeLabel(task.type), task.type)} ${isBlocked(task) ? badge("Заблокировано", "blocked") : ""} ${isOverdue(task) ? badge("Просрочено", "overdue") : ""}</div>
        <div class="task-actions"><button class="btn small edit-task" data-task-id="${task.id}">Изменить</button><button class="btn small danger delete-task" data-task-id="${task.id}">Удалить</button></div>
      </div>
    `;
  }

  function renderCompactTasks(tasks) {
    if (!tasks.length) return emptyState("Нет доступных задач", "Задачи появятся здесь, когда они не заблокированы и ещё не завершены.");
    return `<div class="task-list">${tasks.map((task) => `
      <div class="task-row">
        <div><div class="task-title">${esc(task.title)}</div><div class="task-sub">${esc(getProject(task.projectId)?.name || "Входящие")} · ${formatDate(task.dueDate)}</div></div>
        <div>${badge(statusLabel(task.status), task.status.replace(/\s+/g, ""))}</div>
        <div>${badge(priorityLabel(task.priority), task.priority)}</div>
        <div>${isBlocked(task) ? badge("Заблокировано", "blocked") : badge("Доступно")}</div>
        <div><button class="btn small edit-task" data-task-id="${task.id}">Открыть</button></div>
      </div>
    `).join("")}</div>`;
  }

  function renderBoardView(projectId) {
    const root = $("projectView");
    const tasks = projectTasks(projectId);
    root.innerHTML = `<div class="kanban">${STATUSES.map((status) => `
      <div class="kanban-col" data-status="${status}">
        <h3>${statusLabel(status)}</h3>
        ${tasks.filter((task) => task.status === status).map((task) => `
          <div class="kanban-card" draggable="true" data-task-id="${task.id}">
            <div class="task-title">${esc(task.title)}</div>
            <div class="task-sub">${formatDate(task.dueDate)}</div>
            <div class="meta-row">${badge(priorityLabel(task.priority), task.priority)} ${isBlocked(task) ? badge("Заблокировано", "blocked") : ""}</div>
          </div>
        `).join("")}
      </div>
    `).join("")}</div>`;

    document.querySelectorAll(".kanban-card").forEach((card) => {
      card.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", card.dataset.taskId);
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
      card.addEventListener("click", () => openTaskDrawer(card.dataset.taskId));
    });
    document.querySelectorAll(".kanban-col").forEach((col) => {
      col.addEventListener("dragover", (event) => event.preventDefault());
      col.addEventListener("drop", (event) => {
        event.preventDefault();
        const id = event.dataTransfer.getData("text/plain");
        const task = getTask(id);
        if (task) {
          task.status = col.dataset.status;
          task.updatedAt = new Date().toISOString();
          saveState();
          showToast("Статус задачи обновлён");
          renderProjectWorkspace();
        }
      });
    });
  }

  function renderNodeView(projectId) {
    const root = $("projectView");
    const tasks = projectTasks(projectId);
    const projectRelations = state.relations.filter(r => r.projectId === projectId);
    const shellClass = ui.nodeMapFullscreen ? "node-view-shell map-fullscreen" : "node-view-shell";
    const layoutClass = ui.nodePanelCollapsed ? "node-layout relation-collapsed" : "node-layout";
    root.innerHTML = `
      <div class="${shellClass}" id="nodeViewShell">
        <div class="node-toolbar">
          <div>
            <strong>Карта нод</strong>
            <p class="muted-small">Перетаскивайте ноды, соединяйте выход справа со входом слева. Нажмите на линию, чтобы отсоединить связь.</p>
          </div>
          <div class="node-toolbar-actions">
            <button class="btn small" id="toggleNodePanelBtn">${ui.nodePanelCollapsed ? "Показать правую панель" : "Свернуть правую панель"}</button>
            <button class="btn small primary" id="toggleNodeFullscreenBtn">${ui.nodeMapFullscreen ? "Выйти из полного экрана" : "Карта на весь экран"}</button>
          </div>
        </div>
        <div class="${layoutClass}" id="nodeLayout">
          <div class="node-map" id="nodeMap">
            <svg id="nodeSvg"></svg>
            ${tasks.map(nodeHtml).join("")}
          </div>
          <aside class="relation-panel" id="relationPanel">
            <details class="card relation-section" open>
              <summary>Как работать с нодами</summary>
              <p>Перетащите ноду одним кликом или касанием. Двойной клик / двойное касание открывает детали задачи.</p>
              <p class="connection-hint"><strong>Связи от руки:</strong> потяните из синей точки справа одной ноды к серой точке слева другой ноды.</p>
              <p class="connection-hint"><strong>Отсоединить:</strong> нажмите на линию связи на карте или удалите её из списка связей ниже.</p>
            </details>
            <details class="card relation-section" open>
              <summary>Новая связь</summary>
              <p>Выберите тип линии, а затем соедините задачи мышкой прямо на карте. Списки выбора задач больше не нужны.</p>
              <label>Тип новой связи
                <select id="newRelationType">
                  <option value="blocks" selected>Блокирует / предшествует</option>
                  <option value="depends_on">Зависимость</option>
                  <option value="related">Связано без блокировки</option>
                </select>
              </label>
              <div class="handle-legend">
                <span><i class="legend-dot output-dot"></i>Выход</span>
                <span><i class="legend-dot input-dot"></i>Вход</span>
              </div>
            </details>
            <details class="card relation-section" open>
              <summary>Связи и зависимости</summary>
              ${projectRelations.length ? projectRelations.map(relationHtml).join("") : `<p>Связей пока нет. Соедините выход одной ноды со входом другой.</p>`}
            </details>
          </aside>
        </div>
      </div>
    `;
    bindOptional("toggleNodeFullscreenBtn", () => { ui.nodeMapFullscreen = !ui.nodeMapFullscreen; renderProjectWorkspace(); });
    bindOptional("toggleNodePanelBtn", () => { ui.nodePanelCollapsed = !ui.nodePanelCollapsed; renderProjectWorkspace(); });
    makeNodesInteractive(projectId);
    makeNodeConnections(projectId);
    drawLines(projectId);
    document.querySelectorAll(".delete-relation").forEach((btn) => btn.addEventListener("click", () => deleteRelation(btn.dataset.relId)));
  }

  function nodeHtml(task) {
    const classes = ["node"];
    if (isBlocked(task)) classes.push("blocked-node");
    if (task.status === "Done") classes.push("done-node");
    if (task.type === "Risk") classes.push("risk-node");
    if (task.type === "Milestone") classes.push("milestone-node");
    return `
      <div class="${classes.join(" ")}" data-task-id="${task.id}" style="left:${task.positionX || 80}px;top:${task.positionY || 80}px;">
        <button class="node-handle node-handle-in" data-handle="in" data-task-id="${task.id}" title="Вход связи: сюда можно провести линию" aria-label="Вход связи"></button>
        <button class="node-handle node-handle-out" data-handle="out" data-task-id="${task.id}" title="Выход связи: потяните отсюда к другой задаче" aria-label="Выход связи"></button>
        <div class="node-title">${esc(task.title)}</div>
        <div class="node-meta">${badge(statusLabel(task.status), task.status.replace(/\s+/g, ""))} ${badge(priorityLabel(task.priority), task.priority)} ${badge(typeLabel(task.type), task.type)} ${isBlocked(task) ? badge("Заблокировано", "blocked") : ""}</div>
        <div class="task-sub">${formatDate(task.dueDate)}</div>
      </div>
    `;
  }

  function taskOptions(tasks) {
    return tasks.map((task) => `<option value="${task.id}">${esc(task.title)}</option>`).join("");
  }

  function relationHtml(rel) {
    const source = getTask(rel.sourceTaskId);
    const target = getTask(rel.targetTaskId);
    if (!source || !target) return "";
    const explanation = rel.relationType === "related"
      ? "связано без блокировки"
      : rel.relationType === "depends_on"
        ? "целевая задача зависит от исходной"
        : "исходная задача блокирует целевую";
    return `<div class="relation-item"><span><strong>${esc(source.title)}</strong> → <strong>${esc(target.title)}</strong><br><small>${esc(explanation)}</small></span><button class="btn small danger delete-relation" data-rel-id="${rel.id}">Удалить</button></div>`;
  }

  function makeNodesInteractive(projectId) {
    const map = $("nodeMap");
    let active = null;
    let pointerId = null;
    let offsetX = 0;
    let offsetY = 0;
    let startX = 0;
    let startY = 0;
    let moved = false;
    let lastTouchTap = { taskId: null, time: 0 };

    document.querySelectorAll(".node").forEach((node) => {
      node.addEventListener("pointerdown", (event) => {
        if (event.target.closest(".node-handle")) return;
        if (event.button !== undefined && event.button !== 0) return;
        active = node;
        pointerId = event.pointerId;
        moved = false;
        startX = event.clientX;
        startY = event.clientY;

        const rect = node.getBoundingClientRect();
        offsetX = event.clientX - rect.left;
        offsetY = event.clientY - rect.top;

        node.classList.add("node-dragging");
        if (node.setPointerCapture) node.setPointerCapture(event.pointerId);

        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", onCancel);
        event.preventDefault();
      });

      node.addEventListener("dblclick", (event) => {
        event.preventDefault();
        openTaskDrawer(node.dataset.taskId);
      });
    });

    function onMove(event) {
      if (!active || event.pointerId !== pointerId) return;

      if (Math.abs(event.clientX - startX) > 4 || Math.abs(event.clientY - startY) > 4) {
        moved = true;
      }

      const mapRect = map.getBoundingClientRect();
      const left = Math.max(10, event.clientX - mapRect.left + map.scrollLeft - offsetX);
      const top = Math.max(10, event.clientY - mapRect.top + map.scrollTop - offsetY);
      active.style.left = `${left}px`;
      active.style.top = `${top}px`;
      drawLines(projectId);
    }

    function onUp(event) {
      if (!active || event.pointerId !== pointerId) return;

      const taskId = active.dataset.taskId;
      const task = getTask(taskId);
      if (task) {
        task.positionX = parseInt(active.style.left, 10) || 80;
        task.positionY = parseInt(active.style.top, 10) || 80;
        saveState();
      }

      if (!moved && event.pointerType !== "mouse") {
        const now = Date.now();
        if (lastTouchTap.taskId === taskId && now - lastTouchTap.time < 360) {
          lastTouchTap = { taskId: null, time: 0 };
          openTaskDrawer(taskId);
        } else {
          lastTouchTap = { taskId, time: now };
          showToast("Двойное касание откроет детали задачи");
        }
      }

      finishDrag(event);
    }

    function onCancel(event) {
      if (!active || event.pointerId !== pointerId) return;
      finishDrag(event);
    }

    function finishDrag(event) {
      if (active) {
        active.classList.remove("node-dragging");
        if (active.releasePointerCapture && event && event.pointerId !== undefined) {
          try { active.releasePointerCapture(event.pointerId); } catch (error) {}
        }
      }

      active = null;
      pointerId = null;
      moved = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
    }
  }

  function makeNodeConnections(projectId) {
    const map = $("nodeMap");
    const svg = $("nodeSvg");
    if (!map || !svg) return;

    let sourceTaskId = null;
    let tempLine = null;

    document.querySelectorAll(".node-handle-out").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => {
        sourceTaskId = handle.dataset.taskId;
        map.classList.add("connecting");
        handle.classList.add("active-handle");
        tempLine = createSvgPath("temp-link");
        svg.appendChild(tempLine);
        updateTempLine(event.clientX, event.clientY);

        document.addEventListener("pointermove", onConnectMove);
        document.addEventListener("pointerup", onConnectUp);
        document.addEventListener("pointercancel", cancelConnection);
        event.preventDefault();
        event.stopPropagation();
      });
    });

    document.querySelectorAll(".node-handle-in").forEach((handle) => {
      handle.addEventListener("pointerenter", () => {
        if (sourceTaskId && handle.dataset.taskId !== sourceTaskId) handle.classList.add("handle-target");
      });
      handle.addEventListener("pointerleave", () => handle.classList.remove("handle-target"));
    });

    function onConnectMove(event) {
      if (!sourceTaskId || !tempLine) return;
      updateTempLine(event.clientX, event.clientY);
      event.preventDefault();
    }

    function onConnectUp(event) {
      if (!sourceTaskId) return;
      const targetHandle = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".node-handle-in");
      const targetTaskId = targetHandle ? targetHandle.dataset.taskId : null;

      if (targetTaskId && targetTaskId !== sourceTaskId) {
        const relationType = normalizeRelationType($("newRelationType")?.value);
        addRelationFromMap(projectId, sourceTaskId, targetTaskId, relationType);
      } else {
        showToast("Проведите линию к входной точке другой ноды");
      }

      cancelConnection(event);
    }

    function cancelConnection(event) {
      if (tempLine) tempLine.remove();
      tempLine = null;
      sourceTaskId = null;
      map.classList.remove("connecting");
      document.querySelectorAll(".active-handle, .handle-target").forEach((item) => item.classList.remove("active-handle", "handle-target"));
      document.removeEventListener("pointermove", onConnectMove);
      document.removeEventListener("pointerup", onConnectUp);
      document.removeEventListener("pointercancel", cancelConnection);
      if (event) event.preventDefault();
    }

    function updateTempLine(clientX, clientY) {
      const escapedSourceTaskId = window.CSS?.escape ? CSS.escape(sourceTaskId) : sourceTaskId;
      const sourceNode = document.querySelector(`.node[data-task-id="${escapedSourceTaskId}"]`);
      if (!sourceNode || !tempLine) return;
      const start = getNodeOutputPoint(sourceNode);
      const end = clientToMapPoint(clientX, clientY);
      tempLine.setAttribute("d", curvedPath(start.x, start.y, end.x, end.y));
    }

    function clientToMapPoint(clientX, clientY) {
      const rect = map.getBoundingClientRect();
      return {
        x: clientX - rect.left + map.scrollLeft,
        y: clientY - rect.top + map.scrollTop
      };
    }
  }

  function addRelationFromMap(projectId, sourceTaskId, targetTaskId, relationType) {
    relationType = normalizeRelationType(relationType);
    if (!getProject(projectId) || !getTask(sourceTaskId) || !getTask(targetTaskId)) {
      showToast("Не удалось создать связь: задача или проект не найдены");
      return;
    }
    if (!sourceTaskId || !targetTaskId || sourceTaskId === targetTaskId) {
      showToast("Нельзя соединить задачу саму с собой");
      return;
    }
    if (state.relations.length >= MAX_RELATIONS) return alert("Достигнут лимит связей для локальной версии.");
    const exists = state.relations.some((rel) => rel.sourceTaskId === sourceTaskId && rel.targetTaskId === targetTaskId && rel.relationType === relationType);
    if (exists) {
      showToast("Такая связь уже есть");
      return;
    }
    state.relations.push({
      id: uid("rel"),
      projectId,
      sourceTaskId,
      targetTaskId,
      relationType,
      createdAt: new Date().toISOString()
    });
    saveState();
    showToast("Связь создана на карте");
    renderProjectWorkspace();
  }

  function createSvgPath(className) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", className || "node-link-path");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-linecap", "round");
    return path;
  }

  function curvedPath(x1, y1, x2, y2) {
    const dx = Math.max(70, Math.abs(x2 - x1) * 0.45);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  function getNodeOutputPoint(node) {
    return {
      x: node.offsetLeft + node.offsetWidth,
      y: node.offsetTop + node.offsetHeight / 2
    };
  }

  function getNodeInputPoint(node) {
    return {
      x: node.offsetLeft,
      y: node.offsetTop + node.offsetHeight / 2
    };
  }

  function drawLines(projectId) {
    const svg = $("nodeSvg");
    const map = $("nodeMap");
    if (!svg || !map) return;
    svg.innerHTML = "";

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", "arrowHead");
    marker.setAttribute("markerWidth", "10");
    marker.setAttribute("markerHeight", "10");
    marker.setAttribute("refX", "8");
    marker.setAttribute("refY", "3");
    marker.setAttribute("orient", "auto");
    marker.setAttribute("markerUnits", "strokeWidth");
    const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
    arrow.setAttribute("d", "M0,0 L0,6 L9,3 z");
    arrow.setAttribute("fill", "#2563eb");
    marker.appendChild(arrow);
    defs.appendChild(marker);
    svg.appendChild(defs);

    state.relations.filter((rel) => rel.projectId === projectId).forEach((rel) => {
      const sourceSelectorId = window.CSS?.escape ? CSS.escape(rel.sourceTaskId) : rel.sourceTaskId;
      const targetSelectorId = window.CSS?.escape ? CSS.escape(rel.targetTaskId) : rel.targetTaskId;
      const a = document.querySelector(`.node[data-task-id="${sourceSelectorId}"]`);
      const b = document.querySelector(`.node[data-task-id="${targetSelectorId}"]`);
      if (!a || !b) return;
      const start = getNodeOutputPoint(a);
      const end = getNodeInputPoint(b);
      const path = createSvgPath(`node-link-path ${rel.relationType}`);
      path.setAttribute("d", curvedPath(start.x, start.y, end.x, end.y));
      path.setAttribute("marker-end", "url(#arrowHead)");
      path.dataset.relId = rel.id;
      path.setAttribute("tabindex", "0");
      path.setAttribute("role", "button");
      path.setAttribute("aria-label", "Удалить связь между задачами");
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = "Нажмите, чтобы отсоединить связь";
      path.appendChild(title);
      path.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        deleteRelation(rel.id);
      });
      path.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          deleteRelation(rel.id);
        }
      });
      svg.appendChild(path);
    });
  }

  function renderCalendarView(projectId) {
    $("projectView").innerHTML = calendarHtml(projectId);
    bindCalendar(projectId);
  }

  function renderGlobalCalendar() {
    content.innerHTML = `<section class="panel">${calendarHtml(null)}</section>`;
    bindCalendar(null);
  }

  function calendarHtml(projectId) {
    const date = new Date(ui.calendarDate);
    const monthName = date.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    const tasks = projectId ? projectTasks(projectId) : state.tasks;
    const unscheduled = tasks.filter((task) => !task.dueDate && task.status !== "Done");
    const selectedDate = normalizeDate(ui.selectedCalendarDate) || todayISO();
    const selectedTasks = tasks.filter((task) => task.dueDate === selectedDate);
    const selectedLabel = formatDate(selectedDate);
    const selectedTasksHtml = selectedTasks.length
      ? selectedTasks.map((task) => {
          const project = state.projects.find((p) => p.id === task.projectId);
          return `<button class="selected-date-task edit-task cal-status-${calendarStatusClass(task.status)}" data-task-id="${task.id}" title="Открыть задачу">
            <span class="selected-date-task-title">${esc(task.title)}</span>
            <span class="selected-date-task-meta">${esc(statusLabel(task.status))}${project ? ` · ${esc(project.name)}` : ""}</span>
          </button>`;
        }).join("")
      : `<p class="muted">На выбранную дату задач пока нет. Можно добавить задачу кнопкой ниже или перетащить её из блока «Задачи без даты».</p>`;
    return `
      <div class="calendar-wrap">
        <div>
          <div class="calendar-head">
            <button class="btn small" id="prevMonthBtn">←</button>
            <button class="btn small today-btn" id="todayMonthBtn" title="Вернуть выделение на сегодняшний день">Сегодня</button>
            <button class="selected-date-chip" id="selectedDateChip" title="Нажмите, чтобы выделить сегодняшний день">Выбрано: ${esc(selectedLabel)}</button>
            <div>
              <h3>${monthName}</h3>
              <p class="calendar-hint">Кликните по дате, чтобы выделить её. Перетащите задачу на другую дату, чтобы изменить дедлайн.</p>
              <div class="calendar-legend" aria-label="Цвета задач в календаре">
                <span><i class="status-dot dot-todo"></i>К выполнению</span>
                <span><i class="status-dot dot-progress"></i>В работе</span>
                <span><i class="status-dot dot-done"></i>Готово</span>
                <span><i class="status-dot dot-backlog"></i>Бэклог / нераспределено</span>
              </div>
            </div>
            <button class="btn small" id="nextMonthBtn">→</button>
          </div>
          <div class="calendar-grid" id="calendarGrid">
            ${["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].map(d => `<div class="day-name">${d}</div>`).join("")}
            ${calendarDays(date, tasks)}
          </div>
        </div>
        <aside class="card">
          <h3>Выбранная дата</h3>
          <p><strong>${esc(selectedLabel)}</strong></p>
          <p class="muted">${selectedTasks.length ? `Задач на эту дату: ${selectedTasks.length}` : "На эту дату задач пока нет."}</p>
          <div class="selected-date-summary" aria-label="Краткая информация о задачах выбранной даты">
            ${selectedTasksHtml}
          </div>
          <button class="btn small primary" id="addSelectedDateTask">Добавить задачу на эту дату</button>
          <hr class="soft-divider">
          <h3>Задачи без даты</h3>
          <p>Перетащите задачу на нужный день в календаре или откройте её и выберите дедлайн вручную.</p>
          <div class="unscheduled">${unscheduled.length ? unscheduled.map(t => `<button class="btn small edit-task unscheduled-task calendar-draggable cal-status-${calendarStatusClass(t.status)}" draggable="true" data-task-id="${t.id}" title="Статус: ${esc(statusLabel(t.status))}. Перетащите в календарь или нажмите для редактирования">${esc(t.title)}</button>`).join("") : `<p>Нет задач без даты.</p>`}</div>
        </aside>
      </div>
    `;
  }

  function calendarDays(cursor, tasks) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - startOffset);
    const selectedDate = normalizeDate(ui.selectedCalendarDate) || todayISO();
    const parts = [];
    for (let i = 0; i < 42; i++) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      const iso = toISO(day);
      const dayTasks = tasks.filter((task) => task.dueDate === iso);
      const classes = [
        "day",
        "calendar-dropzone",
        day.getMonth() === month ? "" : "muted",
        iso === todayISO() ? "today-day" : "",
        iso === selectedDate ? "selected-day" : ""
      ].filter(Boolean).join(" ");
      parts.push(`
        <div class="${classes}" data-date="${iso}" title="Кликните, чтобы выделить дату ${esc(formatDate(iso))}">
          <div class="day-num">${day.getDate()}</div>
          ${dayTasks.map(task => `<button class="cal-task edit-task calendar-draggable cal-status-${calendarStatusClass(task.status)} ${task.status === "Done" ? "completed" : ""}" draggable="true" data-task-id="${task.id}" title="Статус: ${esc(statusLabel(task.status))}. Перетащите на другую дату или нажмите для редактирования">${esc(task.title)}</button>`).join("")}
          <button class="btn small add-date-task" data-date="${iso}" title="Добавить задачу на ${esc(formatDate(iso))}">+</button>
        </div>
      `);
    }
    return parts.join("");
  }

  function bindCalendar(projectId) {
    bindOptional("prevMonthBtn", () => { ui.calendarDate.setMonth(ui.calendarDate.getMonth() - 1); render(); });
    bindOptional("todayMonthBtn", () => selectCalendarDate(todayISO(), true));
    bindOptional("selectedDateChip", () => selectCalendarDate(todayISO(), true));
    bindOptional("nextMonthBtn", () => { ui.calendarDate.setMonth(ui.calendarDate.getMonth() + 1); render(); });
    bindOptional("addSelectedDateTask", () => openTaskDrawer(null, projectId || state.projects[0]?.id || null, normalizeDate(ui.selectedCalendarDate) || todayISO()));
    document.querySelectorAll(".calendar-dropzone").forEach((zone) => {
      zone.addEventListener("click", (event) => {
        if (event.target.closest(".cal-task") || event.target.closest(".add-date-task")) return;
        selectCalendarDate(zone.dataset.date, false);
      });
    });
    document.querySelectorAll(".add-date-task").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        selectCalendarDate(btn.dataset.date, false, false);
        openTaskDrawer(null, projectId || state.projects[0]?.id || null, btn.dataset.date);
      });
    });
    bindCalendarDragAndDrop();
    bindTaskLinks();
  }

  function selectCalendarDate(dateValue, moveCalendarToDate = false, shouldRender = true) {
    const safeDate = normalizeDate(dateValue) || todayISO();
    ui.selectedCalendarDate = safeDate;
    if (moveCalendarToDate) {
      const selected = new Date(`${safeDate}T00:00:00`);
      if (!Number.isNaN(selected.getTime())) ui.calendarDate = selected;
    }
    if (shouldRender) render();
  }

  function bindCalendarDragAndDrop() {
    document.querySelectorAll(".calendar-draggable").forEach((item) => {
      item.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", item.dataset.taskId);
        event.dataTransfer.effectAllowed = "move";
        item.classList.add("dragging");
      });
      item.addEventListener("dragend", () => {
        item.classList.remove("dragging");
        document.querySelectorAll(".calendar-dropzone.drag-over").forEach((zone) => zone.classList.remove("drag-over"));
      });
    });

    document.querySelectorAll(".calendar-dropzone").forEach((zone) => {
      zone.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        zone.classList.add("drag-over");
      });
      zone.addEventListener("dragleave", (event) => {
        if (!zone.contains(event.relatedTarget)) zone.classList.remove("drag-over");
      });
      zone.addEventListener("drop", (event) => {
        event.preventDefault();
        zone.classList.remove("drag-over");
        const taskId = event.dataTransfer.getData("text/plain");
        moveCalendarTaskToDate(taskId, zone.dataset.date);
      });
    });
  }

  function moveCalendarTaskToDate(taskId, newDate) {
    const task = getTask(taskId);
    const safeDate = normalizeDate(newDate);
    if (!task || !safeDate) return;
    const oldDate = task.dueDate;
    if (oldDate === safeDate) return;
    task.dueDate = safeDate;
    task.updatedAt = new Date().toISOString();
    saveState();
    showToast(`Задача перенесена на ${formatDate(safeDate)}`);
    render();
  }


  function saveAiSettings() {
    const key = safeText($("aiApiKeyInput")?.value || "", 500);
    const rawModel = safeText($("aiModelInput")?.value || "gpt-4o-mini", 80) || "gpt-4o-mini";
    const model = /^[a-zA-Z0-9_.:-]{1,80}$/.test(rawModel) ? rawModel : "gpt-4o-mini";
    state.settings.aiApiKey = "";
    state.settings.aiModel = model;
    try {
      if (key) localStorage.setItem("flowpm_ai_key", key);
      else localStorage.removeItem("flowpm_ai_key");
    } catch (error) {
      showToast("Не удалось сохранить AI key в браузере");
    }
    saveState();
    showToast(key ? "AI key сохранён локально" : "AI key очищен");
    renderSettings();
  }

  function clearAiSettings() {
    state.settings.aiApiKey = "";
    try { localStorage.removeItem("flowpm_ai_key"); } catch (error) {}
    saveState();
    showToast("AI key удалён");
    renderSettings();
  }

  function getAiApiKey() {
    try { return localStorage.getItem("flowpm_ai_key") || ""; }
    catch (error) { return ""; }
  }

  function openAiPlannerModal(projectId) {
    if (!projectId && !ui.projectId) {
      showToast("Сначала откройте проект");
      return;
    }
    ui.currentAiProjectId = projectId || ui.projectId;
    const project = getProject(ui.currentAiProjectId);
    if (!project) {
      showToast("Проект не найден");
      return;
    }
    const brief = $("aiProjectBrief");
    const deadline = $("aiProjectDeadline");
    const maxTasks = $("aiMaxTasks");
    if (brief) brief.value = project.description ? `${project.name}. ${project.description}` : project.name;
    if (deadline) deadline.value = "";
    if (maxTasks) maxTasks.value = 10;
    $("aiPlannerModal")?.classList.remove("hidden");
  }

  function closeAiPlannerModal() {
    $("aiPlannerModal")?.classList.add("hidden");
  }

  function closeAiPreviewModal() {
    $("aiPreviewModal")?.classList.add("hidden");
    ui.pendingAiResult = null;
  }

  function collectAiProjectContext() {
    const project = getProject(ui.currentAiProjectId || ui.projectId);
    return {
      project,
      existingTasks: project ? projectTasks(project.id) : [],
      existingRelations: project ? state.relations.filter((rel) => rel.projectId === project.id) : [],
      userBrief: safeText($("aiProjectBrief")?.value || "", MAX_LONG_TEXT_LENGTH),
      deadline: normalizeDate($("aiProjectDeadline")?.value || ""),
      maxTasks: Math.max(3, Math.min(30, Number($("aiMaxTasks")?.value || 10))),
      shouldSchedule: Boolean($("aiShouldSchedule")?.checked),
      shouldCreateRelations: Boolean($("aiShouldCreateRelations")?.checked)
    };
  }

  function buildAiPrompt(context) {
    return `Ты AI-помощник project manager внутри локального приложения FlowPM.\n\nТвоя задача — проанализировать вводную информацию пользователя и создать структуру проекта: задачи, описания, статусы, приоритеты, даты, чек-листы и зависимости.\n\nПроект:\n${JSON.stringify(context.project, null, 2)}\n\nУже существующие задачи:\n${JSON.stringify(context.existingTasks, null, 2)}\n\nУже существующие связи:\n${JSON.stringify(context.existingRelations, null, 2)}\n\nВводная информация пользователя:\n${context.userBrief}\n\nДедлайн проекта: ${context.deadline || "не указан"}\nМаксимум задач: ${context.maxTasks}\nНужно ли планировать задачи в календарь: ${context.shouldSchedule}\nНужно ли создавать зависимости: ${context.shouldCreateRelations}\n\nВерни только валидный JSON. Не добавляй markdown. Не добавляй объяснения вне JSON.\n\nФормат ответа:\n{\n  "summary": "краткое описание плана",\n  "tasks": [\n    {\n      "title": "название задачи",\n      "description": "описание",\n      "status": "К выполнению",\n      "priority": "Средний",\n      "type": "Задача",\n      "startDate": "YYYY-MM-DD",\n      "dueDate": "YYYY-MM-DD",\n      "color": "red",\n      "checklist": ["пункт 1", "пункт 2"],\n      "notes": "заметки"\n    }\n  ],\n  "relations": [\n    {\n      "sourceTitle": "название первой задачи",\n      "targetTitle": "название второй задачи",\n      "relationType": "blocks"\n    }\n  ]\n}\n\nРазрешённые статусы: Бэклог, К выполнению, В работе, Готово.\nРазрешённые приоритеты: Низкий, Средний, Высокий, Критический.\nРазрешённые типы: Задача, Веха, Риск.\nРазрешённые цвета: red, yellow, green, gray.\nЛогика цветов: К выполнению = red, В работе = yellow, Готово = green, Бэклог = gray.\nРазрешённые типы связей: blocks, depends_on, related.`;
  }

  async function generateAiProjectPlan() {
    const apiKey = getAiApiKey();
    if (!apiKey) {
      alert("Сначала добавьте API key в настройках или используйте кнопку «Тест без API».");
      return;
    }
    const context = collectAiProjectContext();
    if (!context.project) return alert("Проект не найден.");
    if (!context.userBrief) return alert("Введите вводную информацию по проекту.");

    const btn = $("aiGenerateBtn");
    const oldText = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Генерация..."; }

    try {
      const result = await callOpenAiPlanner(apiKey, buildAiPrompt(context));
      const normalized = normalizeAiResult(result, context);
      closeAiPlannerModal();
      showAiPreview(normalized);
    } catch (error) {
      console.error("AI planner error", error);
      alert(error.message || "Не удалось получить AI-план. Проверьте API key, интернет или попробуйте тестовый режим.");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = oldText; }
    }
  }

  async function callOpenAiPlanner(apiKey, prompt) {
    const model = state.settings.aiModel || "gpt-4o-mini";
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        input: prompt
      })
    });

    if (!response.ok) {
      let message = "Ошибка AI-запроса";
      try {
        const err = await response.json();
        message = err?.error?.message || message;
      } catch (e) {}
      throw new Error(message);
    }

    const data = await response.json();
    const text = extractOpenAiText(data);
    if (!text) throw new Error("AI вернул пустой ответ.");
    return parseAiJson(text);
  }

  function extractOpenAiText(data) {
    if (typeof data.output_text === "string") return data.output_text;
    if (Array.isArray(data.output)) {
      return data.output.flatMap((item) => {
        if (!Array.isArray(item.content)) return [];
        return item.content.map((part) => part.text || part.content || "");
      }).join("\n").trim();
    }
    if (typeof data.text === "string") return data.text;
    return "";
  }

  function parseAiJson(text) {
    if (String(text || "").length > 200000) throw new Error("AI вернул слишком большой ответ.");
    const cleaned = String(text).trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();
    try { return JSON.parse(cleaned); }
    catch (error) {
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
      throw new Error("AI вернул некорректный JSON.");
    }
  }

  function generateMockAiProjectPlan() {
    const context = collectAiProjectContext();
    if (!context.project) return alert("Проект не найден.");
    if (!context.userBrief) return alert("Введите вводную информацию по проекту.");
    const result = generateLocalTestPlan(context);
    closeAiPlannerModal();
    showAiPreview(result);
  }

  function generateLocalTestPlan(context) {
    const deadline = context.deadline || dateAdd(14);
    const max = context.maxTasks || 8;
    const base = [
      ["Уточнить цель и результат", "Сформулировать конечный результат проекта, ключевые ограничения и критерии успеха.", "To Do", "High", "Milestone"],
      ["Собрать требования и вводные", "Собрать всю доступную информацию, документы, пожелания и ограничения по проекту.", "To Do", "High", "Task"],
      ["Разбить работу на этапы", "Определить основные блоки работ и порядок выполнения.", "To Do", "Medium", "Task"],
      ["Подготовить материалы", "Создать необходимые документы, брифы, тексты, макеты или рабочие материалы.", "Backlog", "Medium", "Task"],
      ["Согласовать промежуточный результат", "Проверить готовые материалы с заинтересованными сторонами и собрать правки.", "Backlog", "High", "Milestone"],
      ["Выполнить основную реализацию", "Сделать ключевую часть проекта на основе согласованных материалов.", "Backlog", "High", "Task"],
      ["Проверить качество", "Проверить ошибки, риски, полноту результата и соответствие требованиям.", "Backlog", "Medium", "Risk"],
      ["Завершить проект и подготовить отчёт", "Зафиксировать итог, выводы, следующие шаги и финальные материалы.", "Backlog", "Medium", "Milestone"]
    ].slice(0, max);
    const dates = distributeDates(base.length, deadline, context.shouldSchedule);
    const tasks = base.map((item, index) => ({
      title: item[0],
      description: item[1],
      status: item[2],
      priority: item[3],
      type: item[4],
      startDate: dates[index] || "",
      dueDate: dates[index] || "",
      color: colorByStatus(item[2]),
      checklist: buildChecklistForTitle(item[0]),
      notes: `Тестовый AI-план на основе вводной: ${context.userBrief.slice(0, 120)}${context.userBrief.length > 120 ? "..." : ""}`
    }));
    const relations = context.shouldCreateRelations ? tasks.slice(0, -1).map((task, index) => ({
      sourceTitle: task.title,
      targetTitle: tasks[index + 1].title,
      relationType: "blocks"
    })) : [];
    return normalizeAiResult({ summary: `Тестовый план для проекта «${context.project.name}»`, tasks, relations }, context);
  }

  function distributeDates(count, deadlineIso, shouldSchedule) {
    if (!shouldSchedule) return Array(count).fill("");
    const deadline = fromISO(deadlineIso) || fromISO(dateAdd(14));
    const today = new Date(); today.setHours(0,0,0,0);
    const totalDays = Math.max(1, Math.round((deadline - today) / 86400000));
    const step = Math.max(1, Math.floor(totalDays / Math.max(1, count)));
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + Math.min(totalDays, Math.max(0, i * step)));
      return toISO(d);
    });
  }

  function buildChecklistForTitle(title) {
    if (/требован|вводн/i.test(title)) return ["Собрать исходные данные", "Уточнить ограничения", "Зафиксировать договорённости"];
    if (/качество|провер/i.test(title)) return ["Проверить результат", "Зафиксировать ошибки", "Согласовать исправления"];
    if (/отч/i.test(title)) return ["Собрать итоги", "Описать выводы", "Сформировать следующие шаги"];
    return ["Уточнить задачу", "Выполнить работу", "Проверить результат"];
  }

  function normalizeAiResult(result, context) {
    const maxTasks = Math.max(1, Math.min(30, Number(context?.maxTasks || 30)));
    const tasks = Array.isArray(result?.tasks) ? result.tasks.slice(0, maxTasks).map((task) => {
      const status = normalizeStatus(task?.status);
      return {
        title: safeTitle(task?.title, "Новая задача"),
        description: safeText(task?.description, MAX_DESCRIPTION_LENGTH),
        status,
        priority: normalizePriority(task?.priority),
        type: normalizeType(task?.type),
        startDate: normalizeDate(task?.startDate),
        dueDate: normalizeDate(task?.dueDate),
        color: normalizeColor(task?.color || colorByStatus(status)),
        checklist: sanitizeChecklist(task?.checklist),
        notes: safeText(task?.notes || "AI-generated task", MAX_LONG_TEXT_LENGTH)
      };
    }).filter((task) => task.title) : [];
    const taskTitles = new Set(tasks.map((task) => normalizeTitle(task.title)));
    const existingTasks = Array.isArray(context?.existingTasks) ? context.existingTasks : [];
    const relations = Array.isArray(result?.relations) ? result.relations.slice(0, MAX_RELATIONS).map((rel) => ({
      sourceTitle: safeTitle(rel?.sourceTitle, ""),
      targetTitle: safeTitle(rel?.targetTitle, ""),
      relationType: normalizeRelationType(rel?.relationType)
    })).filter((rel) => rel.sourceTitle && rel.targetTitle && rel.sourceTitle !== rel.targetTitle && (taskTitles.has(normalizeTitle(rel.sourceTitle)) || existingTasks.some(t => normalizeTitle(t.title) === normalizeTitle(rel.sourceTitle))) && (taskTitles.has(normalizeTitle(rel.targetTitle)) || existingTasks.some(t => normalizeTitle(t.title) === normalizeTitle(rel.targetTitle)))) : [];
    if (!tasks.length) throw new Error("AI не предложил задач.");
    return { summary: safeText(result?.summary || "AI предложил план проекта", 500), tasks, relations };
  }

  function normalizeStatus(value) {
    const map = { "Бэклог": "Backlog", "К выполнению": "To Do", "В работе": "In Progress", "Готово": "Done", Backlog: "Backlog", "To Do": "To Do", "In Progress": "In Progress", Done: "Done" };
    return map[value] || "To Do";
  }

  function normalizePriority(value) {
    const map = { "Низкий": "Low", "Средний": "Medium", "Высокий": "High", "Критический": "Critical", Low: "Low", Medium: "Medium", High: "High", Critical: "Critical" };
    return map[value] || "Medium";
  }

  function normalizeType(value) {
    const map = { "Задача": "Task", "Веха": "Milestone", "Риск": "Risk", Task: "Task", Milestone: "Milestone", Risk: "Risk" };
    return map[value] || "Task";
  }

  function normalizeRelationType(value) {
    return RELATIONS.includes(value) ? value : "blocks";
  }

  function normalizeTitle(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function colorByStatus(status) {
    return { Backlog: "gray", "To Do": "red", "In Progress": "yellow", Done: "green" }[status] || "gray";
  }

  function showAiPreview(aiResult) {
    ui.pendingAiResult = aiResult;
    const tasksHtml = aiResult.tasks.map((task, index) => `
      <div class="ai-preview-task" data-ai-task-index="${index}">
        <div>
          <strong>${esc(task.title)}</strong>
          <p>${esc(task.description || "Без описания")}</p>
        </div>
        <span class="ai-pill">${esc(statusLabel(task.status))}</span>
        <span class="ai-pill">${esc(priorityLabel(task.priority))}</span>
        <span class="ai-pill">${esc(formatDate(task.dueDate))}</span>
      </div>
    `).join("");
    const relationsHtml = aiResult.relations?.length ? `
      <h3>Связи</h3>
      <div class="ai-relations-list">${aiResult.relations.map((rel) => `<div class="ai-relation-row"><strong>${esc(rel.sourceTitle)}</strong> → <strong>${esc(rel.targetTitle)}</strong> · ${esc(RELATION_LABEL[rel.relationType] || rel.relationType)}</div>`).join("")}</div>
    ` : `<p class="task-sub">Связи не предложены.</p>`;
    $("aiPreviewContent").innerHTML = `
      <div class="ai-preview-summary"><strong>${esc(aiResult.summary)}</strong><p class="task-sub">Проверьте план. Изменить детали можно после добавления задач в проект.</p></div>
      <h3>Задачи</h3>
      <div class="ai-preview-grid">${tasksHtml}</div>
      ${relationsHtml}
    `;
    $("aiPreviewModal")?.classList.remove("hidden");
  }

  function applyAiPlan() {
    const result = ui.pendingAiResult;
    const projectId = ui.currentAiProjectId || ui.projectId;
    const project = getProject(projectId);
    if (!result || !project) return;
    const now = new Date().toISOString();
    const existingCount = projectTasks(projectId).length;
    const availableSlots = Math.max(0, MAX_TASKS - state.tasks.length);
    if (!availableSlots) return alert("Достигнут лимит задач для локальной версии.");
    const createdTasks = result.tasks.slice(0, availableSlots).map((task, index) => {
      const status = normalizeStatus(task.status);
      return {
        id: uid("task"),
        projectId,
        title: safeTitle(task.title, "Новая задача"),
        description: safeText(task.description || "", MAX_DESCRIPTION_LENGTH),
        status,
        priority: normalizePriority(task.priority),
        type: normalizeType(task.type),
        startDate: normalizeDate(task.startDate),
        dueDate: normalizeDate(task.dueDate),
        color: normalizeColor(task.color || colorByStatus(status)),
        checklist: sanitizeChecklist(task.checklist),
        notes: safeText(task.notes || "AI-generated task", MAX_LONG_TEXT_LENGTH),
        positionX: 70 + ((existingCount + index) % 4) * 250,
        positionY: 70 + Math.floor((existingCount + index) / 4) * 160,
        createdAt: now,
        updatedAt: now
      };
    });
    state.tasks.push(...createdTasks);
    const lookupTasks = [...state.tasks];
    const newRelations = [];
    (result.relations || []).forEach((rel) => {
      const source = lookupTasks.find((task) => normalizeTitle(task.title) === normalizeTitle(rel.sourceTitle) && task.projectId === projectId);
      const target = lookupTasks.find((task) => normalizeTitle(task.title) === normalizeTitle(rel.targetTitle) && task.projectId === projectId);
      if (source && target && source.id !== target.id) {
        const exists = state.relations.some((r) => r.projectId === projectId && r.sourceTaskId === source.id && r.targetTaskId === target.id && r.relationType === rel.relationType);
        if (!exists && state.relations.length + newRelations.length < MAX_RELATIONS) newRelations.push({ id: uid("rel"), projectId, sourceTaskId: source.id, targetTaskId: target.id, relationType: normalizeRelationType(rel.relationType), createdAt: now });
      }
    });
    state.relations.push(...newRelations);
    state.onboardingDone = true;
    saveState();
    closeAiPreviewModal();
    ui.page = "project";
    ui.projectId = projectId;
    ui.tab = "list";
    ui.quickFilter = "all";
    showToast(`Добавлено задач: ${createdTasks.length}`);
    render();
  }

  function renderInbox() {
    content.innerHTML = `
      <section class="panel">
        <div class="toolbar">
          <div><h2>Входящие</h2><p class="task-sub">Быстро фиксируйте задачи перед назначением в проект.</p></div>
        </div>
        <div class="toolbar-left">
          <input class="input" id="inboxInput" maxlength="120" placeholder="Введите быструю задачу..." />
          <button class="btn primary" id="addInboxBtn">Добавить</button>
        </div>
        <br>
        ${state.inbox.length ? `<div class="task-list">${state.inbox.map(inboxRow).join("")}</div>` : emptyState("Входящие пусты", "Добавьте быструю задачу, когда ещё не знаете, к какому проекту она относится.")}
      </section>
    `;
    bindOptional("addInboxBtn", addInboxItem);
    bindOptional("inboxInput", (event) => { if (event.key === "Enter") addInboxItem(); }, "keydown");
    document.querySelectorAll(".assign-inbox").forEach((btn) => btn.addEventListener("click", () => assignInbox(btn.dataset.inboxId)));
    document.querySelectorAll(".delete-inbox").forEach((btn) => btn.addEventListener("click", () => { state.inbox = state.inbox.filter(i => i.id !== btn.dataset.inboxId); saveState(); renderInbox(); }));
  }

  function inboxRow(item) {
    return `
      <div class="task-row">
        <div><div class="task-title">${esc(item.title)}</div><div class="task-sub">Добавлено ${formatDate(item.createdAt.slice(0, 10))}</div></div>
        <div><select data-inbox-select="${item.id}">${state.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></div>
        <div></div><div></div>
        <div class="task-actions"><button class="btn small primary assign-inbox" data-inbox-id="${item.id}">Назначить</button><button class="btn small danger delete-inbox" data-inbox-id="${item.id}">Удалить</button></div>
      </div>
    `;
  }

  function renderSettings() {
    content.innerHTML = `
      <section class="panel">
        <h2>Настройки</h2>
        <p>Ваши данные хранятся только в этом браузере. Нет аккаунта, синхронизации и сервера.</p>
        <div class="grid">
          <div class="card">
            <h3>Рабочее пространство</h3>
            <label>Название пространства<input id="workspaceInput" maxlength="120" value="${esc(state.settings.workspaceName || "Локальное рабочее пространство")}" /></label>
            <br><button class="btn primary" id="saveWorkspaceBtn">Сохранить название</button>
          </div>
          <div class="card">
            <h3>AI-помощник</h3>
            <p>Добавьте API key, чтобы FlowPM мог анализировать вводную информацию и создавать задачи. Ключ хранится отдельно в localStorage и не попадает в экспорт JSON.</p>
            <label>API key
              <input id="aiApiKeyInput" type="password" maxlength="500" value="${esc(getAiApiKey())}" placeholder="sk-..." />
            </label>
            <label>Модель
              <input id="aiModelInput" maxlength="80" value="${esc(state.settings.aiModel || "gpt-4o-mini")}" />
            </label>
            <div class="hero-actions">
              <button class="btn primary" id="saveAiKeyBtn">Сохранить AI key</button>
              <button class="btn secondary" id="clearAiKeyBtn">Удалить AI key</button>
            </div>
            <p class="ai-key-status">Для публичной версии API key нельзя хранить во фронтенде. В этой тестовой версии ключ сохраняется локально.</p>
          </div>
          <div class="card">
            <h3>Данные</h3>
            <p>Экспортируйте резервную копию или импортируйте предыдущий JSON-файл FlowPM.</p>
            <div class="hero-actions">
              <button class="btn secondary" id="exportBtn">Экспорт JSON</button>
              <button class="btn secondary" id="importBtn">Импорт JSON</button>
              <button class="btn danger" id="resetBtn">Сбросить локальные данные</button>
            </div>
          </div>
        </div>
      </section>
    `;
    bindOptional("saveWorkspaceBtn", () => { state.settings.workspaceName = safeTitle($("workspaceInput")?.value, "Локальное рабочее пространство"); saveState(); showToast("Название пространства сохранено"); render(); });
    bindOptional("saveAiKeyBtn", saveAiSettings);
    bindOptional("clearAiKeyBtn", clearAiSettings);
    bindOptional("exportBtn", exportData);
    bindOptional("importBtn", () => $("importFile").click());
    bindOptional("resetBtn", resetData);
  }

  function emptyState(title, text) {
    return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
  }

  function createProjectPrompt() {
    if (state.projects.length >= MAX_PROJECTS) return alert("Достигнут лимит проектов для локальной версии.");
    const name = safeTitle(prompt("Название проекта", "Новый проект"), "");
    if (!name) return;
    const description = safeText(prompt("Описание проекта", "") || "", MAX_DESCRIPTION_LENGTH);
    const project = createProject(name, description);
    state.onboardingDone = true;
    saveState();
    ui.page = "project";
    ui.projectId = project.id;
    ui.tab = "list";
    render();
  }

  function createProject(name, description) {
    if (state.projects.length >= MAX_PROJECTS) throw new Error("Достигнут лимит проектов");
    const now = new Date().toISOString();
    const project = { id: uid("project"), name: safeTitle(name, "Новый проект"), description: safeText(description, MAX_DESCRIPTION_LENGTH), createdAt: now, updatedAt: now };
    state.projects.push(project);
    saveState();
    return project;
  }

  function editProject(id) {
    const project = getProject(id);
    if (!project) return;
    const name = safeTitle(prompt("Название проекта", project.name), "");
    if (!name) return;
    const description = safeText(prompt("Описание проекта", project.description || "") || "", MAX_DESCRIPTION_LENGTH);
    project.name = name;
    project.description = description;
    project.updatedAt = new Date().toISOString();
    saveState();
    render();
  }

  function deleteProject(id) {
    const project = getProject(id);
    if (!project) return;
    if (!confirm(`Удалить проект "${project.name}" и все его задачи?`)) return;
    state.projects = state.projects.filter((p) => p.id !== id);
    state.tasks = state.tasks.filter((task) => task.projectId !== id);
    state.relations = state.relations.filter((rel) => rel.projectId !== id);
    if (ui.projectId === id) ui.projectId = null;
    saveState();
    setPage("projects");
  }

  function openProject(id) {
    ui.page = "project";
    ui.projectId = id;
    ui.tab = "list";
    ui.quickFilter = "all";
    ui.filterStatus = "all";
    ui.filterPriority = "all";
    ui.filterType = "all";
    ui.dashboardFilter = "all";
    render();
  }

  function openProjectTaskList(projectId, filterMode = "all") {
    ui.page = "project";
    ui.projectId = projectId;
    ui.tab = "list";
    ui.quickFilter = filterMode || "all";
    ui.filterStatus = "all";
    ui.filterPriority = "all";
    ui.filterType = "all";
    ui.dashboardFilter = "all";
    render();
  }

  function openDashboardFilter(filterMode) {
    const matching = tasksByQuickFilter(state.tasks, filterMode);
    if (!matching.length) {
      ui.dashboardFilter = filterMode;
      renderDashboard();
      showToast("По этому фильтру задач пока нет");
      return;
    }
    const projectIds = [...new Set(matching.map((task) => task.projectId).filter(Boolean))];
    if (projectIds.length === 1) {
      openProjectTaskList(projectIds[0], filterMode);
      return;
    }
    ui.dashboardFilter = filterMode;
    renderDashboard();
  }

  function openTaskDrawer(taskId, projectId = null, dueDate = "") {
    const task = taskId ? getTask(taskId) : null;
    const projects = state.projects;
    if (!projects.length) {
      showToast("Сначала создайте проект");
      createProjectPrompt();
      return;
    }
    $("drawerTitle").textContent = task ? "Изменить задачу" : "Новая задача";
    $("taskId").value = task?.id || "";
    $("taskTitle").value = task?.title || "";
    $("taskDescription").value = task?.description || "";
    $("taskStatus").value = task?.status || "Backlog";
    $("taskPriority").value = task?.priority || "Medium";
    $("taskType").value = task?.type || "Task";
    $("taskStartDate").value = task?.startDate || "";
    $("taskDueDate").value = task?.dueDate || dueDate || "";
    $("taskChecklist").value = Array.isArray(task?.checklist) ? task.checklist.join("\n") : "";
    $("taskNotes").value = task?.notes || "";
    $("taskProject").innerHTML = projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    $("taskProject").value = task?.projectId || projectId || ui.projectId || projects[0].id;
    $("deleteTaskBtn").style.visibility = task ? "visible" : "hidden";
    $("dependencyInfo").innerHTML = task ? dependencyInfo(task) : `<p>После сохранения задачи её можно связать с другими задачами на карте нод.</p>`;
    drawer.classList.remove("hidden");
    overlay.classList.remove("hidden");
    $("taskTitle").focus();
  }

  function closeTaskDrawer() {
    drawer.classList.add("hidden");
    overlay.classList.add("hidden");
  }

  function dependencyInfo(task) {
    const incoming = state.relations.filter((rel) => rel.targetTaskId === task.id).map((rel) => getTask(rel.sourceTaskId)?.title).filter(Boolean);
    const outgoing = state.relations.filter((rel) => rel.sourceTaskId === task.id).map((rel) => getTask(rel.targetTaskId)?.title).filter(Boolean);
    return `
      <p><strong>Заблокировано:</strong> ${isBlocked(task) ? "Да" : "Нет"}</p>
      <p><strong>Зависит от:</strong> ${incoming.length ? incoming.map(esc).join(", ") : "Нет"}</p>
      <p><strong>Связано с:</strong> ${outgoing.length ? outgoing.map(esc).join(", ") : "Нет"}</p>
    `;
  }

  function saveTask(event) {
    event.preventDefault();
    const id = $("taskId").value;
    const now = new Date().toISOString();
    const projectId = $("taskProject").value;
    const title = safeTitle($("taskTitle").value, "");
    if (!getProject(projectId)) {
      showToast("Выберите существующий проект");
      return;
    }
    if (!title) {
      showToast("Название задачи не может быть пустым");
      $("taskTitle")?.focus();
      return;
    }
    const startDate = normalizeDate($("taskStartDate").value);
    const dueDate = normalizeDate($("taskDueDate").value);
    if ($("taskStartDate").value && !startDate) {
      showToast("Некорректная дата начала");
      return;
    }
    if ($("taskDueDate").value && !dueDate) {
      showToast("Некорректный дедлайн");
      return;
    }
    if (startDate && dueDate && startDate > dueDate) {
      showToast("Дата начала не может быть позже дедлайна");
      return;
    }
    const data = {
      projectId,
      title,
      description: safeText($("taskDescription").value, MAX_DESCRIPTION_LENGTH),
      status: normalizeStatus($("taskStatus").value),
      priority: normalizePriority($("taskPriority").value),
      type: normalizeType($("taskType").value),
      startDate,
      dueDate,
      checklist: sanitizeChecklist($("taskChecklist").value.split("\n")),
      notes: safeText($("taskNotes").value, MAX_LONG_TEXT_LENGTH),
      updatedAt: now
    };

    if (id) {
      const task = getTask(id);
      if (task) Object.assign(task, data);
    } else {
      if (state.tasks.length >= MAX_TASKS) return alert("Достигнут лимит задач для локальной версии.");
      const index = projectTasks(projectId).length;
      state.tasks.push({
        id: uid("task"),
        ...data,
        positionX: 70 + (index % 4) * 250,
        positionY: 70 + Math.floor(index / 4) * 160,
        createdAt: now
      });
    }
    state.onboardingDone = true;
    saveState();
    closeTaskDrawer();
    showToast("Задача сохранена");
    if (ui.page === "dashboard" && projectId) { ui.page = "project"; ui.projectId = projectId; }
    render();
  }

  function deleteTask(id) {
    const task = getTask(id || $("taskId").value);
    if (!task) return;
    if (!confirm(`Удалить задачу "${task.title}"?`)) return;
    state.tasks = state.tasks.filter((item) => item.id !== task.id);
    state.relations = state.relations.filter((rel) => rel.sourceTaskId !== task.id && rel.targetTaskId !== task.id);
    saveState();
    closeTaskDrawer();
    showToast("Задача удалена");
    render();
  }

  function addRelation(projectId) {
    const sourceTaskId = $("relSource")?.value || "";
    const targetTaskId = $("relTarget")?.value || "";
    const relationType = normalizeRelationType($("relType")?.value);
    if (!sourceTaskId || !targetTaskId || sourceTaskId === targetTaskId) {
      showToast("Выберите две разные задачи");
      return;
    }
    const exists = state.relations.some((rel) => rel.sourceTaskId === sourceTaskId && rel.targetTaskId === targetTaskId && rel.relationType === relationType);
    if (exists) {
      showToast("Такая связь уже существует");
      return;
    }
    if (state.relations.length >= MAX_RELATIONS) return alert("Достигнут лимит связей для локальной версии.");
    state.relations.push({ id: uid("rel"), projectId, sourceTaskId, targetTaskId, relationType, createdAt: new Date().toISOString() });
    saveState();
    showToast("Связь добавлена");
    renderProjectWorkspace();
  }

  function deleteRelation(id) {
    state.relations = state.relations.filter((rel) => rel.id !== id);
    saveState();
    showToast("Связь удалена");
    renderProjectWorkspace();
  }

  function addInboxItem() {
    const input = $("inboxInput");
    const title = safeTitle(input?.value, "");
    if (!title) {
      showToast("Название входящей задачи не может быть пустым");
      input?.focus();
      return;
    }
    if (state.inbox.length >= MAX_INBOX) return alert("Достигнут лимит входящих задач.");
    state.inbox.push({ id: uid("inbox"), title, createdAt: new Date().toISOString() });
    input.value = "";
    saveState();
    renderInbox();
  }

  function assignInbox(id) {
    const item = state.inbox.find((entry) => entry.id === id);
    const select = document.querySelector(`[data-inbox-select="${id}"]`);
    const projectId = select?.value;
    if (!item || !projectId || !getProject(projectId)) {
      showToast("Сначала создайте или выберите существующий проект");
      return;
    }
    const now = new Date().toISOString();
    const index = projectTasks(projectId).length;
    state.tasks.push({
      id: uid("task"),
      projectId,
      title: safeTitle(item.title, "Новая задача"),
      description: "",
      status: "Backlog",
      priority: "Medium",
      type: "Task",
      startDate: "",
      dueDate: "",
      checklist: [],
      notes: "",
      positionX: 70 + (index % 4) * 250,
      positionY: 70 + Math.floor(index / 4) * 160,
      createdAt: now,
      updatedAt: now
    });
    state.inbox = state.inbox.filter((entry) => entry.id !== id);
    saveState();
    showToast("Задача из входящих назначена");
    renderInbox();
  }

  function loadDemoData() {
    const project = createProject("Запуск маркетинговой кампании", "Демо-проект с задачами, зависимостями, нодами и календарным планированием.");
    const demo = [
      ["Определить цель кампании", "Уточнить цель, аудиторию и метрику успеха.", "Done", "High", "Milestone", 0, 70, 70],
      ["Согласовать бюджет кампании", "Подтвердить ответственного за бюджет и лимиты расходов.", "To Do", "Critical", "Task", 1, 340, 70],
      ["Подготовить креативный бриф", "Сформулировать ключевое сообщение и требования к креативам.", "In Progress", "High", "Task", 2, 70, 250],
      ["Разработать рекламные креативы", "Подготовить статичные и видео-материалы для рекламы.", "Backlog", "High", "Task", 4, 340, 250],
      ["Настроить рекламную кампанию", "Создать кампанию, аудитории и отслеживание.", "Backlog", "Medium", "Task", 5, 610, 250],
      ["Запустить кампанию", "Активировать рекламу после готовности креативов и настроек.", "Backlog", "Critical", "Milestone", 7, 475, 430],
      ["Отслеживать результаты", "Проверить первые результаты и возможности оптимизации.", "Backlog", "Medium", "Task", 9, 745, 430],
      ["Подготовить итоговый отчёт", "Собрать результаты, выводы и рекомендации.", "Backlog", "Medium", "Task", 12, 745, 610]
    ];
    const now = new Date().toISOString();
    const created = demo.map(([title, description, status, priority, type, offset, x, y]) => ({
      id: uid("task"),
      projectId: project.id,
      title,
      description,
      status,
      priority,
      type,
      startDate: "",
      dueDate: dateAdd(offset),
      checklist: [],
      notes: "",
      positionX: x,
      positionY: y,
      createdAt: now,
      updatedAt: now
    }));
    state.tasks.push(...created);
    const byTitle = (title) => created.find((task) => task.title === title).id;
    const rel = (source, target) => state.relations.push({ id: uid("rel"), projectId: project.id, sourceTaskId: byTitle(source), targetTaskId: byTitle(target), relationType: "depends_on", createdAt: now });
    rel("Определить цель кампании", "Подготовить креативный бриф");
    rel("Подготовить креативный бриф", "Разработать рекламные креативы");
    rel("Согласовать бюджет кампании", "Настроить рекламную кампанию");
    rel("Разработать рекламные креативы", "Запустить кампанию");
    rel("Настроить рекламную кампанию", "Запустить кампанию");
    rel("Запустить кампанию", "Отслеживать результаты");
    rel("Отслеживать результаты", "Подготовить итоговый отчёт");
    state.onboardingDone = true;
    saveState();
    ui.page = "project";
    ui.projectId = project.id;
    ui.tab = "nodes";
    showToast("Демо загружено");
    render();
  }

  function exportData() {
    const exportState = sanitizeState(state);
    if (exportState.settings) exportState.settings.aiApiKey = "";
    const blob = new Blob([JSON.stringify(exportState, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flowpm-backup-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      alert("Файл слишком большой для локального импорта. Максимальный размер — 1,5 МБ.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = String(reader.result || "");
        if (raw.length > MAX_FILE_SIZE_BYTES * 2) throw new Error("Файл слишком большой");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.projects) || !Array.isArray(parsed.tasks)) throw new Error("Некорректный файл");
        const sanitized = sanitizeState(parsed);
        if (!confirm(`Импортировать данные? Будет загружено проектов: ${sanitized.projects.length}, задач: ${sanitized.tasks.length}, связей: ${sanitized.relations.length}. Текущие данные будут заменены.`)) return;
        state = sanitized;
        saveState();
        ui.page = "dashboard";
        ui.projectId = null;
        ui.quickFilter = "all";
        ui.dashboardFilter = "all";
        showToast("Данные импортированы безопасно");
        render();
      } catch (error) {
        console.warn("Import error", error);
        alert("Не удалось импортировать файл. Проверьте, что это корректная резервная копия FlowPM в формате JSON.");
      }
    };
    reader.onerror = () => alert("Не удалось прочитать файл.");
    reader.readAsText(file);
  }

  function resetData() {
    if (!confirm("Сбросить все данные FlowPM, сохранённые в этом браузере?")) return;
    state = defaultState();
    saveState();
    ui = { page: "dashboard", projectId: null, tab: "list", calendarDate: new Date(), selectedCalendarDate: todayISO(), filterStatus: "all", filterPriority: "all", filterType: "all", quickFilter: "all", dashboardFilter: "all", pendingAiResult: null, currentAiProjectId: null, nodePanelCollapsed: false, nodeMapFullscreen: false };
    showToast("Локальные данные сброшены");
    render();
  }

  function bindGlobalEvents() {
    document.querySelectorAll(".nav-btn").forEach((btn) => btn.addEventListener("click", () => setPage(btn.dataset.page)));
    bindOptional("menuBtn", () => sidebar.classList.toggle("open"));
    bindOptional("demoBtn", loadDemoData);
    bindOptional("newTaskBtn", () => openTaskDrawer(null, ui.projectId || state.projects[0]?.id || null));
    bindOptional("closeDrawerBtn", closeTaskDrawer);
    bindOptional("overlay", closeTaskDrawer);
    bindOptional("taskForm", saveTask, "submit");
    bindOptional("deleteTaskBtn", () => deleteTask());
    bindOptional("closeAiPlannerBtn", closeAiPlannerModal);
    bindOptional("closeAiPreviewBtn", closeAiPreviewModal);
    bindOptional("cancelAiPlanBtn", closeAiPreviewModal);
    bindOptional("aiGenerateBtn", generateAiProjectPlan);
    bindOptional("aiMockGenerateBtn", generateMockAiProjectPlan);
    bindOptional("applyAiPlanBtn", applyAiPlan);
    bindOptional("importFile", (event) => { const file = event.target.files[0]; if (file) importData(file); event.target.value = ""; }, "change");
  }

  function bindProjectCards() {
    document.querySelectorAll(".open-project").forEach((btn) => btn.addEventListener("click", () => openProject(btn.dataset.projectId)));
    document.querySelectorAll(".edit-project").forEach((btn) => btn.addEventListener("click", () => editProject(btn.dataset.projectId)));
    document.querySelectorAll(".delete-project").forEach((btn) => btn.addEventListener("click", () => deleteProject(btn.dataset.projectId)));
  }

  function bindQuickFilters() {
    document.querySelectorAll(".badge-action, .open-project-filter").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openProjectTaskList(btn.dataset.projectId, btn.dataset.filter || "all");
      });
    });
    document.querySelectorAll(".dashboard-filter").forEach((btn) => {
      btn.addEventListener("click", () => openDashboardFilter(btn.dataset.filter || "all"));
    });
    document.querySelectorAll(".clear-dashboard-filter").forEach((btn) => {
      btn.addEventListener("click", () => { ui.dashboardFilter = "all"; renderDashboard(); });
    });
  }

  function bindTaskLinks() {
    document.querySelectorAll(".edit-task").forEach((btn) => btn.addEventListener("click", () => openTaskDrawer(btn.dataset.taskId)));
    document.querySelectorAll(".delete-task").forEach((btn) => btn.addEventListener("click", () => deleteTask(btn.dataset.taskId)));
  }

  function bindOptional(id, handler, eventName = "click") {
    const el = typeof id === "string" ? $(id) : id;
    if (el) el.addEventListener(eventName, handler);
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.remove("hidden");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.add("hidden"), 1800);
  }
})();
