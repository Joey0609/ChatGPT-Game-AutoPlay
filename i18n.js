/**
 * Translations for everything the user can see: the popup and the in-page panel. The language is part
 * of the persisted config (`lang`, default English) and is picked in the popup, so the extension's UI
 * does not depend on the browser's locale.
 *
 * Only UI text lives here. Console logs stay English on purpose: the README documents their exact
 * wording, and they are read by developers, not by users.
 */
(() => {
  'use strict';

  const DEFAULT_LANG = 'en';

  // The order of this list is the order of the popup's language select. Labels are written in their
  // own language, so they need no translation.
  const LANGUAGES = [
    { id: 'en', label: 'English' },
    { id: 'zh', label: '中文' },
    { id: 'fr', label: 'Français' },
    { id: 'ru', label: 'Русский' },
    { id: 'es', label: 'Español' }
  ];

  const MESSAGES = {
    en: {
      appTitle: 'Snake Autoplay',
      site: 'ChatGPT waiting game',
      autoPlay: 'Auto-play',
      showPanel: 'Show panel',
      strategy: 'Strategy',
      language: 'Language',
      algBfs: 'Safe BFS',
      algFlood: 'Flood fill',
      algCycle: 'Hamiltonian cycle',
      version: 'Version {version}',
      checking: 'Checking this page…',
      boardFound: 'Game board detected',
      waitingBoard: 'Waiting for the game board',
      pageReload: 'Refresh the ChatGPT page to use it.',
      autoOn: 'Auto-play is on',
      autoOff: 'Auto-play is paused',
      savedReload: 'Settings saved; refresh the page to apply.',
      panelTitle: 'Snake auto-play',
      boardUnknown: 'Board not recognized',
      notStarted: 'Not started',
      sourceFiber: 'React state',
      sourceCanvas: 'Canvas read',
      autoOffSuffix: ' · auto off',
      emptyWaiting: 'Waiting for a readable board',
      emptyNotStarted: 'The game has not started yet',
      toggleOn: 'Auto: on',
      toggleOff: 'Auto: off',
      waitingStart: 'Waiting for the game to start',
      routeSteps: '{steps} steps → {target}',
      fieldGrid: 'Grid',
      fieldLength: 'Length',
      fieldHead: 'Head',
      fieldFood: 'Food',
      fieldDirection: 'Direction',
      fieldReason: 'Reason',
      fieldSource: 'Source',
      fieldRoute: 'Route',
      reasonFoodPath: 'BFS to the food',
      reasonSpaceThenFood: 'room, then food',
      reasonSpace: 'most room',
      reasonCycle: 'follow the cycle',
      reasonCycleEat: 'cycle, food ahead',
      reasonCycleFallback: 'cycle, low room',
      reasonTrapped: 'trapped',
      reasonTailEscape: 'into the tail cell'
    },
    zh: {
      appTitle: 'Snake Autoplay',
      site: 'ChatGPT 等待游戏',
      autoPlay: '自动游玩',
      showPanel: '显示面板',
      strategy: '策略',
      language: '语言',
      algBfs: '安全寻路 (BFS)',
      algFlood: '空间优先 (Flood)',
      algCycle: '哈密顿环 (Cycle)',
      version: '版本 {version}',
      checking: '检查当前页面…',
      boardFound: '已检测到游戏画板',
      waitingBoard: '等待游戏画板出现',
      pageReload: '刷新 ChatGPT 页面后即可使用。',
      autoOn: '自动游玩已开启',
      autoOff: '自动游玩已暂停',
      savedReload: '已保存设置；刷新页面后生效。',
      panelTitle: '贪吃蛇自动游玩',
      boardUnknown: '画板未识别',
      notStarted: '未开始',
      sourceFiber: 'React 状态',
      sourceCanvas: '画布识别',
      autoOffSuffix: ' · 自动关',
      emptyWaiting: '等待可识别的棋盘',
      emptyNotStarted: '游戏还没开始',
      toggleOn: '自动：开',
      toggleOff: '自动：关',
      waitingStart: '等待游戏开始',
      routeSteps: '{steps} 步 → {target}',
      fieldGrid: '网格',
      fieldLength: '蛇长',
      fieldHead: '蛇头',
      fieldFood: '食物',
      fieldDirection: '方向',
      fieldReason: '依据',
      fieldSource: '状态源',
      fieldRoute: '路线',
      reasonFoodPath: 'BFS 寻路到食物',
      reasonSpaceThenFood: '先保空间再靠近食物',
      reasonSpace: '空间最大',
      reasonCycle: '沿环走',
      reasonCycleEat: '沿环，食物在前',
      reasonCycleFallback: '空间不足回到环',
      reasonTrapped: '被围住',
      reasonTailEscape: '进入尾格'
    },
    fr: {
      appTitle: 'Snake Autoplay',
      site: 'Jeu d’attente ChatGPT',
      autoPlay: 'Lecture auto',
      showPanel: 'Afficher le panneau',
      strategy: 'Stratégie',
      language: 'Langue',
      algBfs: 'BFS sûr',
      algFlood: 'Remplissage (Flood)',
      algCycle: 'Cycle hamiltonien',
      version: 'Version {version}',
      checking: 'Vérification de la page…',
      boardFound: 'Plateau de jeu détecté',
      waitingBoard: 'En attente du plateau de jeu',
      pageReload: 'Actualisez la page ChatGPT pour l’utiliser.',
      autoOn: 'Lecture auto activée',
      autoOff: 'Lecture auto en pause',
      savedReload: 'Réglages enregistrés ; actualisez la page.',
      panelTitle: 'Lecture auto du serpent',
      boardUnknown: 'Plateau non reconnu',
      notStarted: 'Pas commencé',
      sourceFiber: 'État React',
      sourceCanvas: 'Lecture canvas',
      autoOffSuffix: ' · auto désactivé',
      emptyWaiting: 'En attente d’un plateau lisible',
      emptyNotStarted: 'La partie n’a pas encore commencé',
      toggleOn: 'Auto : activé',
      toggleOff: 'Auto : désactivé',
      waitingStart: 'En attente du début de la partie',
      routeSteps: '{steps} pas → {target}',
      fieldGrid: 'Grille',
      fieldLength: 'Longueur',
      fieldHead: 'Tête',
      fieldFood: 'Nourriture',
      fieldDirection: 'Direction',
      fieldReason: 'Raison',
      fieldSource: 'Source',
      fieldRoute: 'Trajet',
      reasonFoodPath: 'BFS vers la nourriture',
      reasonSpaceThenFood: 'espace puis nourriture',
      reasonSpace: 'plus d’espace',
      reasonCycle: 'suivre le cycle',
      reasonCycleEat: 'cycle, nourriture devant',
      reasonCycleFallback: 'cycle, peu d’espace',
      reasonTrapped: 'coincé',
      reasonTailEscape: 'vers la queue'
    },
    ru: {
      appTitle: 'Snake Autoplay',
      site: 'Игра ожидания ChatGPT',
      autoPlay: 'Автоигра',
      showPanel: 'Показать панель',
      strategy: 'Стратегия',
      language: 'Язык',
      algBfs: 'Безопасный BFS',
      algFlood: 'Заливка пространства',
      algCycle: 'Гамильтонов цикл',
      version: 'Версия {version}',
      checking: 'Проверка страницы…',
      boardFound: 'Игровое поле найдено',
      waitingBoard: 'Ожидание игрового поля',
      pageReload: 'Обновите страницу ChatGPT, чтобы использовать расширение.',
      autoOn: 'Автоигра включена',
      autoOff: 'Автоигра на паузе',
      savedReload: 'Настройки сохранены; обновите страницу.',
      panelTitle: 'Автоигра «Змейка»',
      boardUnknown: 'Поле не распознано',
      notStarted: 'Не начато',
      sourceFiber: 'Состояние React',
      sourceCanvas: 'Чтение canvas',
      autoOffSuffix: ' · авто выкл.',
      emptyWaiting: 'Ожидание распознаваемого поля',
      emptyNotStarted: 'Игра ещё не началась',
      toggleOn: 'Авто: вкл.',
      toggleOff: 'Авто: выкл.',
      waitingStart: 'Ожидание начала игры',
      routeSteps: '{steps} шагов → {target}',
      fieldGrid: 'Сетка',
      fieldLength: 'Длина',
      fieldHead: 'Голова',
      fieldFood: 'Еда',
      fieldDirection: 'Направление',
      fieldReason: 'Причина',
      fieldSource: 'Источник',
      fieldRoute: 'Маршрут',
      reasonFoodPath: 'BFS к еде',
      reasonSpaceThenFood: 'сначала место, затем еда',
      reasonSpace: 'больше места',
      reasonCycle: 'идти по циклу',
      reasonCycleEat: 'цикл, еда впереди',
      reasonCycleFallback: 'цикл, мало места',
      reasonTrapped: 'в ловушке',
      reasonTailEscape: 'в клетку хвоста'
    },
    es: {
      appTitle: 'Snake Autoplay',
      site: 'Juego de espera de ChatGPT',
      autoPlay: 'Reproducción automática',
      showPanel: 'Mostrar panel',
      strategy: 'Estrategia',
      language: 'Idioma',
      algBfs: 'BFS seguro',
      algFlood: 'Relleno de espacio',
      algCycle: 'Ciclo hamiltoniano',
      version: 'Versión {version}',
      checking: 'Comprobando la página…',
      boardFound: 'Tablero de juego detectado',
      waitingBoard: 'Esperando el tablero de juego',
      pageReload: 'Actualiza la página de ChatGPT para usarlo.',
      autoOn: 'Reproducción automática activada',
      autoOff: 'Reproducción automática en pausa',
      savedReload: 'Ajustes guardados; actualiza la página.',
      panelTitle: 'Reproducción automática de la serpiente',
      boardUnknown: 'Tablero no reconocido',
      notStarted: 'Sin empezar',
      sourceFiber: 'Estado de React',
      sourceCanvas: 'Lectura del lienzo',
      autoOffSuffix: ' · auto desactivado',
      emptyWaiting: 'Esperando un tablero legible',
      emptyNotStarted: 'La partida aún no ha empezado',
      toggleOn: 'Auto: activado',
      toggleOff: 'Auto: desactivado',
      waitingStart: 'Esperando a que empiece la partida',
      routeSteps: '{steps} pasos → {target}',
      fieldGrid: 'Rejilla',
      fieldLength: 'Longitud',
      fieldHead: 'Cabeza',
      fieldFood: 'Comida',
      fieldDirection: 'Dirección',
      fieldReason: 'Motivo',
      fieldSource: 'Origen',
      fieldRoute: 'Ruta',
      reasonFoodPath: 'BFS hacia la comida',
      reasonSpaceThenFood: 'espacio y luego comida',
      reasonSpace: 'más espacio',
      reasonCycle: 'seguir el ciclo',
      reasonCycleEat: 'ciclo, comida delante',
      reasonCycleFallback: 'ciclo, poco espacio',
      reasonTrapped: 'atrapado',
      reasonTailEscape: 'hacia la cola'
    }
  };

  // Panel arrow labels, indexed like Algorithms.DIRS (up, right, down, left).
  const DIRECTIONS = {
    en: ['Up', 'Right', 'Down', 'Left'],
    zh: ['上', '右', '下', '左'],
    fr: ['Haut', 'Droite', 'Bas', 'Gauche'],
    ru: ['Вверх', 'Вправо', 'Вниз', 'Влево'],
    es: ['Arriba', 'Derecha', 'Abajo', 'Izquierda']
  };

  // Decision reasons come out of algorithms.js as stable ids; the panel shows them translated.
  const REASONS = {
    'food-path': 'reasonFoodPath',
    'space-then-food': 'reasonSpaceThenFood',
    space: 'reasonSpace',
    cycle: 'reasonCycle',
    'cycle-eat': 'reasonCycleEat',
    'cycle-fallback': 'reasonCycleFallback',
    trapped: 'reasonTrapped',
    'tail-escape': 'reasonTailEscape'
  };

  function has(lang) {
    return typeof lang === 'string' && Object.prototype.hasOwnProperty.call(MESSAGES, lang);
  }

  function normalizeLang(value) {
    return has(value) ? value : DEFAULT_LANG;
  }

  // Looks a key up in `lang`, falls back to English and finally to the key itself, then substitutes
  // `{name}` placeholders. Never throws: a missing translation must not break the panel.
  function t(lang, key, vars) {
    const chosen = normalizeLang(lang);
    let text = MESSAGES[chosen][key];
    if (typeof text !== 'string') text = MESSAGES[DEFAULT_LANG][key];
    if (typeof text !== 'string') return key;
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (match, name) => (
      vars[name] === undefined || vars[name] === null ? match : String(vars[name])
    ));
  }

  function dirNames(lang) {
    return (DIRECTIONS[normalizeLang(lang)] || DIRECTIONS[DEFAULT_LANG]).slice();
  }

  // Maps an algorithm id to its translated label; unknown ids keep the label from algorithms.js.
  function algLabel(lang, id, fallback) {
    const key = id === 'bfs' ? 'algBfs' : (id === 'flood' ? 'algFlood' : (id === 'cycle' ? 'algCycle' : null));
    if (!key) return fallback || id;
    return t(lang, key);
  }

  function reason(lang, raw) {
    const key = REASONS[raw];
    return key ? t(lang, key) : String(raw);
  }

  window.SnakeI18n = {
    DEFAULT_LANG,
    LANGUAGES,
    has,
    normalizeLang,
    t,
    dirNames,
    algLabel,
    reason,
    // Exposed for the tests: every language must carry the same keys.
    MESSAGES
  };
})();
