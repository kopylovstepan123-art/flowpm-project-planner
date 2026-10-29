(function () {
  "use strict";

  const STORAGE_KEY = "flowpm_ru_local_v1";
  const STATUSES = ["Backlog", "To Do", "In Progress", "Done"];
  const PRIORITIES = ["Low", "Medium", "High", "Critical"];
  const TYPES = ["Task", "Milestone", "Risk"];
  const RELATIONS = ["depends_on", "blocks", "related"];
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
    filterStatus: "all",
    filterPriority: "all",
    filterType: "all",
    quickFilter: "all",
    dashboardFilter: "all"
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
      settings: { workspaceName: "Локальное рабочее пространство" },
      onboardingDone: false
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return {
        ...defaultState(),
        ...parsed,
        settings: { ...defaultState().settings, ...(parsed.settings || {}) }
      };
    } catch (error) {
      console.warn("FlowPM: failed to load local data", error);
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function ensureUsableState() {
    if (!Array.isArray(state.projects)) state.projects = [];
    if (!Array.isArray(state.tasks)) state.tasks = [];
    if (!Array.isArray(state.relations)) state.relations = [];
    if (!Array.isArray(state.inbox)) state.inbox = [];
    if (!state.settings) state.settings = { workspaceName: "Локальное рабочее пространство" };
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
    if (!iso) return null;
    const parts = iso.split("-").map(Number);
    if (parts.length !== 3) return null;
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
    const safe = esc(value).replace(/\s+/g, "");
    return `<span class="badge ${safe} ${extra}">${esc(value)}</span>`;
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
    root.innerHTML = `
      <div class="node-layout">
        <div class="node-map" id="nodeMap">
          <svg id="nodeSvg"></svg>
          ${tasks.map(nodeHtml).join("")}
        </div>
        <aside class="relation-panel">
          <div class="card">
            <h3>Как работать с нодами</h3>
            <p>Перетащите ноду одним кликом или касанием. Двойной клик / двойное касание открывает детали задачи.</p>
            <p class="connection-hint"><strong>Связи от руки:</strong> потяните из синей точки справа одной ноды к серой точке слева другой ноды.</p>
          </div>
          <div class="card">
            <h3>Новая связь</h3>
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
          </div>
          <div class="card">
            <h3>Связи</h3>
            ${state.relations.filter(r => r.projectId === projectId).length ? state.relations.filter(r => r.projectId === projectId).map(relationHtml).join("") : `<p>Связей пока нет. Соедините выход одной ноды со входом другой.</p>`}
          </div>
        </aside>
      </div>
    `;
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
        const relationType = $("newRelationType")?.value || "blocks";
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
      const sourceNode = document.querySelector(`.node[data-task-id="${sourceTaskId}"]`);
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
    if (!sourceTaskId || !targetTaskId || sourceTaskId === targetTaskId) {
      showToast("Нельзя соединить задачу саму с собой");
      return;
    }
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
      const a = document.querySelector(`.node[data-task-id="${rel.sourceTaskId}"]`);
      const b = document.querySelector(`.node[data-task-id="${rel.targetTaskId}"]`);
      if (!a || !b) return;
      const start = getNodeOutputPoint(a);
      const end = getNodeInputPoint(b);
      const path = createSvgPath(`node-link-path ${rel.relationType}`);
      path.setAttribute("d", curvedPath(start.x, start.y, end.x, end.y));
      path.setAttribute("marker-end", "url(#arrowHead)");
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
    return `
      <div class="calendar-wrap">
        <div>
          <div class="calendar-head">
            <button class="btn small" id="prevMonthBtn">←</button>
            <div>
              <h3>${monthName}</h3>
              <p class="calendar-hint">Перетащите задачу на другую дату, чтобы изменить дедлайн.</p>
              <div class="calendar-legend" aria-label="Цвета задач в календаре">
                <span><i class="status-dot dot-todo"></i>К выполнению</span>
                <span><i class="status-dot dot-progress"></i>В работе</span>
                <span><i class="status-dot dot-done"></i>Готово</span>
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
          <h3>Задачи без даты</h3>
          <p>Перетащите задачу на нужный день в календаре или откройте её и выберите дедлайн вручную.</p>
          <div class="unscheduled">${unscheduled.length ? unscheduled.map(t => `<button class="btn small edit-task unscheduled-task calendar-draggable cal-status-${calendarStatusClass(t.status)}" draggable="true" data-task-id="${t.id}" title="Статус: ${statusLabel(t.status)}. Перетащите в календарь или нажмите для редактирования">${esc(t.title)}</button>`).join("") : `<p>Нет задач без даты.</p>`}</div>
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
    const parts = [];
    for (let i = 0; i < 42; i++) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      const iso = toISO(day);
      const dayTasks = tasks.filter((task) => task.dueDate === iso);
      parts.push(`
        <div class="day calendar-dropzone ${day.getMonth() === month ? "" : "muted"}" data-date="${iso}">
          <div class="day-num">${day.getDate()}</div>
          ${dayTasks.map(task => `<button class="cal-task edit-task calendar-draggable cal-status-${calendarStatusClass(task.status)} ${task.status === "Done" ? "completed" : ""}" draggable="true" data-task-id="${task.id}" title="Статус: ${statusLabel(task.status)}. Перетащите на другую дату или нажмите для редактирования">${esc(task.title)}</button>`).join("")}
          <button class="btn small add-date-task" data-date="${iso}">+</button>
        </div>
      `);
    }
    return parts.join("");
  }

  function bindCalendar(projectId) {
    bindOptional("prevMonthBtn", () => { ui.calendarDate.setMonth(ui.calendarDate.getMonth() - 1); render(); });
    bindOptional("nextMonthBtn", () => { ui.calendarDate.setMonth(ui.calendarDate.getMonth() + 1); render(); });
    document.querySelectorAll(".add-date-task").forEach((btn) => {
      btn.addEventListener("click", () => openTaskDrawer(null, projectId || state.projects[0]?.id || null, btn.dataset.date));
    });
    bindCalendarDragAndDrop();
    bindTaskLinks();
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
    if (!task || !newDate) return;
    const oldDate = task.dueDate;
    if (oldDate === newDate) return;
    task.dueDate = newDate;
    task.updatedAt = new Date().toISOString();
    saveState();
    showToast(`Задача перенесена на ${formatDate(newDate)}`);
    render();
  }

  function renderInbox() {
    content.innerHTML = `
      <section class="panel">
        <div class="toolbar">
          <div><h2>Входящие</h2><p class="task-sub">Быстро фиксируйте задачи перед назначением в проект.</p></div>
        </div>
        <div class="toolbar-left">
          <input class="input" id="inboxInput" placeholder="Введите быструю задачу..." />
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
            <label>Название пространства<input id="workspaceInput" value="${esc(state.settings.workspaceName || "Локальное рабочее пространство")}" /></label>
            <br><button class="btn primary" id="saveWorkspaceBtn">Сохранить название</button>
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
    bindOptional("saveWorkspaceBtn", () => { state.settings.workspaceName = $("workspaceInput").value.trim() || "Локальное рабочее пространство"; saveState(); showToast("Название пространства сохранено"); render(); });
    bindOptional("exportBtn", exportData);
    bindOptional("importBtn", () => $("importFile").click());
    bindOptional("resetBtn", resetData);
  }

  function emptyState(title, text) {
    return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
  }

  function createProjectPrompt() {
    const name = prompt("Название проекта", "Новый проект");
    if (!name || !name.trim()) return;
    const description = prompt("Описание проекта", "") || "";
    const project = createProject(name.trim(), description.trim());
    state.onboardingDone = true;
    saveState();
    ui.page = "project";
    ui.projectId = project.id;
    ui.tab = "list";
    render();
  }

  function createProject(name, description) {
    const now = new Date().toISOString();
    const project = { id: uid("project"), name, description, createdAt: now, updatedAt: now };
    state.projects.push(project);
    saveState();
    return project;
  }

  function editProject(id) {
    const project = getProject(id);
    if (!project) return;
    const name = prompt("Название проекта", project.name);
    if (!name || !name.trim()) return;
    const description = prompt("Описание проекта", project.description || "") || "";
    project.name = name.trim();
    project.description = description.trim();
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
    const data = {
      projectId,
      title: $("taskTitle").value.trim(),
      description: $("taskDescription").value.trim(),
      status: $("taskStatus").value,
      priority: $("taskPriority").value,
      type: $("taskType").value,
      startDate: $("taskStartDate").value,
      dueDate: $("taskDueDate").value,
      checklist: $("taskChecklist").value.split("\n").map((x) => x.trim()).filter(Boolean),
      notes: $("taskNotes").value.trim(),
      updatedAt: now
    };
    if (!data.title) return;

    if (id) {
      const task = getTask(id);
      if (task) Object.assign(task, data);
    } else {
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
    const sourceTaskId = $("relSource").value;
    const targetTaskId = $("relTarget").value;
    const relationType = $("relType").value;
    if (!sourceTaskId || !targetTaskId || sourceTaskId === targetTaskId) {
      showToast("Выберите две разные задачи");
      return;
    }
    const exists = state.relations.some((rel) => rel.sourceTaskId === sourceTaskId && rel.targetTaskId === targetTaskId && rel.relationType === relationType);
    if (exists) {
      showToast("Такая связь уже существует");
      return;
    }
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
    const title = input.value.trim();
    if (!title) return;
    state.inbox.push({ id: uid("inbox"), title, createdAt: new Date().toISOString() });
    input.value = "";
    saveState();
    renderInbox();
  }

  function assignInbox(id) {
    const item = state.inbox.find((entry) => entry.id === id);
    const select = document.querySelector(`[data-inbox-select="${id}"]`);
    const projectId = select?.value;
    if (!item || !projectId) {
      showToast("Сначала создайте проект");
      return;
    }
    const now = new Date().toISOString();
    const index = projectTasks(projectId).length;
    state.tasks.push({
      id: uid("task"),
      projectId,
      title: item.title,
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
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
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
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.tasks)) throw new Error("Некорректный файл");
        state = { ...defaultState(), ...parsed, settings: { ...defaultState().settings, ...(parsed.settings || {}) } };
        saveState();
        ui.page = "dashboard";
        ui.projectId = null;
        ui.quickFilter = "all";
        ui.dashboardFilter = "all";
        showToast("Данные импортированы");
        render();
      } catch (error) {
        alert("Не удалось импортировать файл. Выберите корректную резервную копию FlowPM в формате JSON.");
      }
    };
    reader.readAsText(file);
  }

  function resetData() {
    if (!confirm("Сбросить все данные FlowPM, сохранённые в этом браузере?")) return;
    state = defaultState();
    saveState();
    ui = { page: "dashboard", projectId: null, tab: "list", calendarDate: new Date(), filterStatus: "all", filterPriority: "all", filterType: "all", quickFilter: "all", dashboardFilter: "all" };
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
