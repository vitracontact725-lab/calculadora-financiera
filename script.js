/* ==========================================================================
   CALCULADORA DE INTERÉS COMPUESTO - Lógica
   --------------------------------------------------------------------------
   Todo se calcula en el navegador. No se envía ningún dato a ningún servidor.

   Cómo está organizado este archivo:
     1. Configuración (monedas, límites)
     2. Referencias a elementos de la página
     3. Funciones para leer y mostrar números (formato argentino: 1.250.000,50)
     4. Validación del formulario
     5. Cálculo del interés compuesto
     6. Mostrar resultados y tabla
     7. Gráfico (SVG dibujado con JavaScript, sin librerías)
     8. Acciones de los botones y eventos
   ========================================================================== */

'use strict'; // Modo estricto: ayuda a detectar errores de programación


/* ==========================================================================
   1. CONFIGURACIÓN
   ========================================================================== */

// Monedas disponibles. Solo cambia el símbolo: NO se convierte entre monedas.
// Para agregar otra moneda, sumá una línea acá y una <option> en index.html.
const CURRENCIES = {
  ARS: { symbol: '$' },
  USD: { symbol: 'US$' },
  EUR: { symbol: '€' }
};

// Límites que usa la validación
const LIMITS = {
  maxMoney: 1e12,   // monto máximo para capital y aporte
  maxRate: 200,     // tasa anual máxima (%)
  maxYears: 100,    // período máximo (años)
  maxResult: 1e15   // si el resultado supera esto, se pide reducir los valores
};

// Nombres de las frecuencias de capitalización (para el texto del resumen)
const COMPOUNDING_NAMES = { 1: 'anual', 2: 'semestral', 4: 'trimestral', 12: 'mensual' };

// Cantidad máxima de puntos que se dibujan en el gráfico
const MAX_CHART_POINTS = 120;


/* ==========================================================================
   2. REFERENCIAS A ELEMENTOS DE LA PÁGINA
   ========================================================================== */
const $ = (id) => document.getElementById(id);

const els = {
  form: $('calc-form'),
  currency: $('currency'),
  initial: $('initial'),
  contribution: $('contribution'),
  rate: $('rate'),
  years: $('years'),
  compounding: $('compounding'),
  formError: $('form-error'),
  btnClear: $('btn-clear'),
  btnExample: $('btn-example'),
  results: $('results'),
  resultsTitle: $('results-title'),
  summary: $('results-summary'),
  resFinal: $('res-final'),
  resContributed: $('res-contributed'),
  resInterest: $('res-interest'),
  resReturn: $('res-return'),
  chart: $('chart'),
  tooltip: $('chart-tooltip'),
  tableBody: $('table-body'),
  year: $('year')
};

// Campos de texto que se validan (el nombre coincide con el id del input)
const FIELD_KEYS = ['initial', 'contribution', 'rate', 'years'];

// Acá se guarda el último cálculo, para poder redibujar sin volver a calcular
// (por ejemplo, al cambiar de moneda o al girar el teléfono).
const state = { result: null, chartWidth: 0 };


/* ==========================================================================
   3. NÚMEROS: LEER Y MOSTRAR
   ========================================================================== */

/**
 * Convierte el texto que escribió la persona en un número.
 * Acepta el formato argentino ("1.250.000,50") y también "1250000.5".
 * Devuelve NaN si no se puede interpretar.
 *
 * @param {string} text            Texto escrito en el campo
 * @param {boolean} allowThousands Si es true, un texto como "1.500" se lee como
 *                                 mil quinientos (útil para montos de dinero).
 */
function parseNumber(text, allowThousands) {
  if (text === null || text === undefined) return NaN;

  // Quitamos espacios y símbolos que la persona pudo escribir
  let s = String(text).replace(/\s|\u00A0/g, '').replace(/US\$|[$€%]/gi, '');
  if (s === '') return NaN;

  // Signo negativo (lo detectamos para poder avisar que no se permite)
  let negative = false;
  if (s[0] === '-') {
    negative = true;
    s = s.slice(1);
  }

  // Solo se permiten dígitos, puntos y comas, y al menos un dígito
  if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return NaN;

  const commas = (s.match(/,/g) || []).length;
  const dots = (s.match(/\./g) || []).length;

  if (commas > 1) return NaN;

  if (commas === 1) {
    // La coma es el decimal. Si hay puntos, tienen que ser separadores de miles.
    if (dots > 0 && !/^[1-9]\d{0,2}(\.\d{3})+,\d*$/.test(s)) return NaN;
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (dots > 0) {
    if (allowThousands && /^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '');          // "1.250.000" -> 1250000
    } else if (dots > 1) {
      return NaN;                        // "1.2.3" no es válido
    }                                    // "2.5" queda como decimal
  }

  const n = Number(s);
  return negative ? -n : n;
}

/**
 * Da formato a un número con separador de miles (.) y decimal (,).
 * Ejemplo: formatFixed(1250000.5, 2) -> "1.250.000,50"
 */
function formatFixed(n, decimals) {
  const negative = n < 0;
  const parts = Math.abs(n).toFixed(decimals).split('.');
  const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (negative ? '-' : '') + integerPart + (parts[1] ? ',' + parts[1] : '');
}

/**
 * Igual que formatFixed, pero sin ceros sobrantes al final.
 * Ejemplo: formatFlexible(2.5, 2) -> "2,5"   |   formatFlexible(10, 2) -> "10"
 */
function formatFlexible(n, maxDecimals) {
  let text = formatFixed(n, maxDecimals);
  if (text.indexOf(',') !== -1) text = text.replace(/,?0+$/, '');
  return text;
}

/** Símbolo de la moneda elegida ($, US$ o €). */
function currencySymbol() {
  return CURRENCIES[els.currency.value].symbol;
}

/** Muestra un monto con símbolo. Ejemplo: "$1.250.000" o "US$ 1.250.000". */
function formatMoney(n, decimals) {
  const sym = currencySymbol();
  const space = sym.length > 1 ? '\u00A0' : '';   // "US$" lleva un espacio fino
  return sym + space + formatFixed(n, decimals);
}

/** Igual que formatMoney, pero solo muestra decimales si hacen falta. */
function formatMoneyFlexible(n) {
  const sym = currencySymbol();
  const space = sym.length > 1 ? '\u00A0' : '';
  return sym + space + formatFlexible(n, 2);
}

/** Números cortos para el eje del gráfico: 1.500.000 -> "1,5 M". */
function formatCompact(n) {
  const abs = Math.abs(n);
  if (abs >= 1e9) return formatFlexible(n / 1e9, 1) + ' mil M';
  if (abs >= 1e6) return formatFlexible(n / 1e6, 1) + ' M';
  if (abs >= 1e3) return formatFlexible(n / 1e3, 1) + ' mil';
  return formatFlexible(n, 2);
}

/** Etiqueta de tiempo para una cantidad de meses. 12 -> "Año 1", 30 -> "Año 2,5". */
function yearLabel(months) {
  return 'Año ' + formatFlexible(months / 12, 2);
}

/** Tiempo transcurrido en palabras. 47 -> "3 años y 11 meses", 12 -> "1 año". */
function elapsedLabel(months) {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const yearsText = y + (y === 1 ? ' año' : ' años');
  const monthsText = m + (m === 1 ? ' mes' : ' meses');
  if (y === 0) return monthsText;
  return m === 0 ? yearsText : yearsText + ' y ' + monthsText;
}


/* ==========================================================================
   4. VALIDACIÓN
   ========================================================================== */

/** Muestra (o borra, si el mensaje está vacío) el error debajo de un campo. */
function showError(key, message) {
  const input = els[key];
  $(key + '-error').textContent = message || '';
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  input.closest('.input-group').classList.toggle('is-invalid', Boolean(message));
}

/** Borra todos los mensajes de error. */
function clearErrors() {
  FIELD_KEYS.forEach((key) => showError(key, ''));
  els.formError.textContent = '';
}

/**
 * Lee los campos y los valida.
 * Devuelve { values, errors }. Si "errors" está vacío, los datos son correctos.
 */
function readAndValidate() {
  const errors = {};
  const values = {};

  // --- Capital inicial y aporte periódico (montos de dinero) ---
  const moneyFields = [
    { key: 'initial', empty: 'Ingresá el capital inicial. Si no tenés, escribí 0.', name: 'El capital inicial' },
    { key: 'contribution', empty: 'Ingresá el aporte periódico. Si no vas a aportar, escribí 0.', name: 'El aporte' }
  ];

  moneyFields.forEach((field) => {
    const raw = els[field.key].value.trim();
    const n = parseNumber(raw, true);

    if (raw === '') {
      errors[field.key] = field.empty;
    } else if (Number.isNaN(n)) {
      errors[field.key] = 'Ingresá un número válido, por ejemplo 100.000 o 2500,50.';
    } else if (n < 0) {
      errors[field.key] = field.name + ' no puede ser negativo.';
    } else if (n > LIMITS.maxMoney) {
      errors[field.key] = 'El monto es demasiado grande. Ingresá un valor menor a ' + formatFixed(LIMITS.maxMoney, 0) + '.';
    } else {
      values[field.key] = n;
    }
  });

  // Tiene que haber algo para calcular
  if (values.initial === 0 && values.contribution === 0) {
    errors.contribution = 'Ingresá un capital inicial o un aporte mayor que cero para poder calcular.';
  }

  // --- Tasa anual ---
  const rawRate = els.rate.value.trim();
  const rate = parseNumber(rawRate, false);
  if (rawRate === '') {
    errors.rate = 'Ingresá la tasa de rendimiento anual.';
  } else if (Number.isNaN(rate)) {
    errors.rate = 'Ingresá un número válido, por ejemplo 8 o 7,5.';
  } else if (rate < 0) {
    errors.rate = 'La tasa no puede ser negativa.';
  } else if (rate > LIMITS.maxRate) {
    errors.rate = 'Ingresá una tasa razonable, entre 0 % y ' + LIMITS.maxRate + ' %.';
  } else {
    values.rate = rate;
  }

  // --- Período en años ---
  const rawYears = els.years.value.trim();
  const years = parseNumber(rawYears, false);
  if (rawYears === '') {
    errors.years = 'Ingresá el período de inversión en años.';
  } else if (Number.isNaN(years)) {
    errors.years = 'Ingresá un número válido, por ejemplo 10 o 2,5.';
  } else if (years <= 0) {
    errors.years = 'El período debe ser mayor que cero.';
  } else if (Math.round(years * 12) < 1) {
    errors.years = 'El período mínimo es de 1 mes (0,09 años).';
  } else if (years > LIMITS.maxYears) {
    errors.years = 'El período máximo es de ' + LIMITS.maxYears + ' años.';
  } else {
    values.years = years;
  }

  // --- Opciones (siempre válidas porque se eligen de una lista) ---
  values.contribFreq = Number(els.form.elements.contribFreq.value);   // 12 = mensual, 1 = anual
  values.compounding = Number(els.compounding.value);                 // 1, 2, 4 o 12 veces por año

  return { values, errors };
}


/* ==========================================================================
   5. CÁLCULO DEL INTERÉS COMPUESTO
   ========================================================================== */

/**
 * Simula la inversión mes a mes.
 *
 * Cómo funciona la matemática:
 *  - La tasa ingresada es nominal anual y se capitaliza "m" veces por año.
 *    Cada período de capitalización rinde  tasa / m.
 *  - Para poder sumar aportes mensuales y capitalizaciones de distinta frecuencia
 *    en un mismo cálculo, usamos el factor de crecimiento equivalente de UN MES:
 *
 *        factorMensual = (1 + tasa / m) ^ (m / 12)
 *
 *    Con capitalización mensual, esto es exactamente (1 + tasa / 12).
 *    Con otras frecuencias, después de 12 meses el capital crece igual que con
 *    la fórmula clásica  C · (1 + tasa / m) ^ m.
 *  - Los aportes se suman al final de cada mes (o de cada año).
 *
 * Devuelve la lista de "puntos": points[i] es el estado al final del mes i.
 */
function simulate(values) {
  const monthlyFactor = Math.pow(1 + values.rate / 100 / values.compounding, values.compounding / 12);
  const totalMonths = Math.round(values.years * 12);

  let balance = values.initial;       // dinero total acumulado
  let contributed = values.initial;   // dinero puesto de tu bolsillo

  const points = [{ month: 0, contributed: contributed, balance: balance }];

  for (let month = 1; month <= totalMonths; month++) {
    balance = balance * monthlyFactor;              // 1) el capital genera interés

    const isContributionMonth = values.contribFreq === 12 || month % 12 === 0;
    if (isContributionMonth) {                      // 2) se suma el aporte
      balance += values.contribution;
      contributed += values.contribution;
    }

    points.push({ month: month, contributed: contributed, balance: balance });
  }

  return { points: points, totalMonths: totalMonths };
}

/**
 * Separa un punto en aportes, intereses y total, todos redondeados igual,
 * para que "aportes + intereses = total" se cumpla siempre en pantalla.
 */
function splitAmounts(point, decimals) {
  const factor = Math.pow(10, decimals);
  const total = Math.round(point.balance * factor) / factor;
  const contributed = Math.round(point.contributed * factor) / factor;
  const interest = Math.max(0, Math.round((total - contributed) * factor) / factor);
  return { total: total, contributed: contributed, interest: interest };
}


/* ==========================================================================
   6. MOSTRAR RESULTADOS Y TABLA
   ========================================================================== */

/** Escribe el resumen y las tarjetas de resultados. */
function renderNumbers() {
  const r = state.result;
  const last = splitAmounts(r.points[r.points.length - 1], r.decimals);

  els.resFinal.textContent = formatMoney(last.total, r.decimals);
  els.resContributed.textContent = formatMoney(last.contributed, r.decimals);
  els.resInterest.textContent = formatMoney(last.interest, r.decimals);

  const returnPct = last.contributed > 0 ? (last.interest / last.contributed) * 100 : 0;
  els.resReturn.textContent = formatFlexible(returnPct, 1) + ' %';

  // Resumen en una frase, para que se entienda con qué datos se calculó
  const v = r.inputs;
  const yearsValue = r.totalMonths / 12;
  els.summary.textContent =
    'Simulación con un capital inicial de ' + formatMoneyFlexible(v.initial) +
    ' y aportes ' + (v.contribFreq === 12 ? 'mensuales' : 'anuales') +
    ' de ' + formatMoneyFlexible(v.contribution) +
    ', a una tasa de ' + formatFlexible(v.rate, 2) + ' % anual con capitalización ' +
    COMPOUNDING_NAMES[v.compounding] + ', durante ' + formatFlexible(yearsValue, 2) +
    (yearsValue === 1 ? ' año.' : ' años.');
}

/** Arma la tabla año por año. */
function renderTable() {
  const r = state.result;

  // Una fila por cada año completo, y una fila final si el período no es un número exacto de años
  const months = [];
  for (let m = 12; m <= r.totalMonths; m += 12) months.push(m);
  if (r.totalMonths % 12 !== 0) months.push(r.totalMonths);

  const fragment = document.createDocumentFragment();

  months.forEach((m) => {
    const a = splitAmounts(r.points[m], r.decimals);
    const row = document.createElement('tr');

    const yearCell = document.createElement('th');
    yearCell.scope = 'row';
    yearCell.textContent = yearLabel(m);
    row.appendChild(yearCell);

    [a.contributed, a.interest, a.total].forEach((amount) => {
      const cell = document.createElement('td');
      cell.textContent = formatMoney(amount, r.decimals);
      row.appendChild(cell);
    });

    fragment.appendChild(row);
  });

  els.tableBody.innerHTML = '';
  els.tableBody.appendChild(fragment);
}

/** Muestra todo: números, tabla y gráfico. */
function renderAll() {
  renderNumbers();
  renderTable();
  drawChart();
}

/** Oculta los resultados y vacía gráfico y tabla. */
function hideResults() {
  state.result = null;
  els.results.hidden = true;
  els.chart.innerHTML = '';
  els.tableBody.innerHTML = '';
  els.tooltip.hidden = true;
}

/** Baja suavemente hasta los resultados y avisa a los lectores de pantalla. */
function scrollToResults() {
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (typeof els.results.scrollIntoView === 'function') {
    els.results.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }
  els.resultsTitle.focus({ preventScroll: true });
}


/* ==========================================================================
   7. GRÁFICO (SVG)
   ========================================================================== */

/** Calcula una escala "redonda" para el eje vertical (por ejemplo 0, 2 M, 4 M, 6 M). */
function niceScale(maxValue, maxTicks) {
  const rough = maxValue / maxTicks;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const fraction = rough / power;
  let niceFraction;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 2.5) niceFraction = 2.5;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;

  const step = niceFraction * power;
  const top = Math.ceil(maxValue / step - 1e-9) * step;
  return { step: step, top: top };
}

/** Dibuja el gráfico de evolución. Se adapta al ancho disponible. */
function drawChart() {
  const r = state.result;
  if (!r) return;

  const points = r.points;
  const totalMonths = r.totalMonths;

  // --- Tamaño ---
  const width = Math.max(Math.floor(els.chart.clientWidth) || 320, 220);
  const compact = width < 480;
  const height = compact ? 280 : 360;
  state.chartWidth = width;

  // --- Escala vertical ---
  const maxValue = points[points.length - 1].balance;
  const scale = niceScale(maxValue, compact ? 4 : 5);
  const yTicks = [];
  const tickCount = Math.round(scale.top / scale.step);
  for (let i = 0; i <= tickCount; i++) yTicks.push(i * scale.step);

  // Margen izquierdo según el largo de las etiquetas
  const longestLabel = Math.max.apply(null, yTicks.map((v) => formatCompact(v).length));
  const margin = { top: 30, right: 14, bottom: 44, left: Math.ceil(longestLabel * 6.4) + 16 };

  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const baseY = margin.top + plotHeight;

  const xOf = (month) => margin.left + (month / totalMonths) * plotWidth;
  const yOf = (value) => baseY - (value / scale.top) * plotHeight;

  // --- Puntos que se dibujan (no hace falta uno por mes si hay muchos) ---
  const stride = Math.max(1, Math.ceil(totalMonths / MAX_CHART_POINTS));
  const indexes = [];
  for (let m = 0; m < totalMonths; m += stride) indexes.push(m);
  indexes.push(totalMonths);

  const line = (valueOf) =>
    indexes.map((m, i) => (i === 0 ? 'M' : 'L') + xOf(m).toFixed(1) + ',' + yOf(valueOf(points[m])).toFixed(1)).join(' ');
  const lineBack = (valueOf) =>
    indexes.slice().reverse().map((m) => 'L' + xOf(m).toFixed(1) + ',' + yOf(valueOf(points[m])).toFixed(1)).join(' ');

  const contribOf = (p) => p.contributed;
  const totalOf = (p) => p.balance;

  const contribLine = line(contribOf);
  const contribArea = contribLine + ' L' + xOf(totalMonths).toFixed(1) + ',' + baseY + ' L' + xOf(0).toFixed(1) + ',' + baseY + ' Z';
  const interestArea = line(totalOf) + ' ' + lineBack(contribOf) + ' Z';

  // --- Marcas del eje horizontal (años, o meses si el período es corto) ---
  const totalYears = totalMonths / 12;
  const maxXTicks = compact ? 5 : 8;
  let xStepMonths, xLabel, xTitle;
  if (totalYears < 2) {
    const monthSteps = [1, 2, 3, 6];
    const chosen = monthSteps.find((s) => totalMonths / s <= maxXTicks) || 6;
    xStepMonths = chosen;
    xLabel = (m) => String(m);
    xTitle = 'Meses';
  } else {
    const yearSteps = [1, 2, 5, 10, 20, 25, 50];
    const chosen = yearSteps.find((s) => totalYears / s <= maxXTicks) || 50;
    xStepMonths = chosen * 12;
    xLabel = (m) => String(m / 12);
    xTitle = 'Años';
  }

  // --- Se arma el SVG ---
  const last = splitAmounts(points[points.length - 1], r.decimals);
  const description =
    'Gráfico de área. Al final del período el capital estimado es ' + formatMoney(last.total, r.decimals) +
    ', formado por ' + formatMoney(last.contributed, r.decimals) + ' aportados y ' +
    formatMoney(last.interest, r.decimals) + ' de intereses. El detalle está en la tabla siguiente.';

  let svg = '';
  svg += '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="img" aria-labelledby="chart-title chart-desc">';
  svg += '<title id="chart-title">Evolución del capital</title>';
  svg += '<desc id="chart-desc">' + description + '</desc>';

  // Franjas diagonales verdes para los intereses (así no dependen solo del color)
  svg += '<defs><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
         '<rect width="7" height="7" fill="#cdeedd"/><line x1="0" y1="0" x2="0" y2="7" stroke="#0b7a4b" stroke-width="2.5"/></pattern></defs>';

  // Líneas horizontales de guía y sus etiquetas
  yTicks.forEach((v) => {
    const y = yOf(v).toFixed(1);
    svg += '<line class="grid-line" x1="' + margin.left + '" x2="' + (width - margin.right) + '" y1="' + y + '" y2="' + y + '"/>';
    svg += '<text class="axis-text" x="' + (margin.left - 8) + '" y="' + (Number(y) + 4) + '" text-anchor="end">' + formatCompact(v) + '</text>';
  });
  svg += '<text class="axis-text" x="4" y="14">Monto en ' + els.currency.value + '</text>';

  // Áreas y líneas
  svg += '<path class="area-contrib" d="' + contribArea + '"/>';
  svg += '<path fill="url(#hatch)" d="' + interestArea + '"/>';
  svg += '<path class="line-contrib" d="' + contribLine + '"/>';
  svg += '<path class="line-total" d="' + line(totalOf) + '"/>';

  // Eje horizontal
  svg += '<line class="axis-line" x1="' + margin.left + '" x2="' + (width - margin.right) + '" y1="' + baseY + '" y2="' + baseY + '"/>';
  for (let m = 0; m <= totalMonths; m += xStepMonths) {
    const x = xOf(m).toFixed(1);
    svg += '<line class="axis-line" x1="' + x + '" x2="' + x + '" y1="' + baseY + '" y2="' + (baseY + 5) + '"/>';
    svg += '<text class="axis-text" x="' + x + '" y="' + (baseY + 19) + '" text-anchor="middle">' + xLabel(m) + '</text>';
  }
  svg += '<text class="axis-text" x="' + (margin.left + plotWidth / 2) + '" y="' + (height - 6) + '" text-anchor="middle">' + xTitle + '</text>';

  // Elementos que aparecen al tocar o pasar el cursor
  svg += '<g id="hover" style="display:none">' +
         '<line class="hover-line" id="hover-line" y1="' + margin.top + '" y2="' + baseY + '"/>' +
         '<circle class="hover-dot" id="hover-dot-total" r="4.5"/>' +
         '<circle class="hover-dot" id="hover-dot-contrib" r="4.5"/></g>';
  svg += '<rect id="chart-overlay" x="' + margin.left + '" y="' + margin.top + '" width="' + plotWidth + '" height="' + plotHeight + '" fill="transparent"/>';
  svg += '</svg>';

  els.chart.innerHTML = svg;
  els.tooltip.hidden = true;

  // --- Interacción: mostrar valores al tocar o pasar el cursor ---
  const svgEl = els.chart.querySelector('svg');
  const overlay = svgEl.querySelector('#chart-overlay');
  const hover = svgEl.querySelector('#hover');
  const hoverLine = svgEl.querySelector('#hover-line');
  const dotTotal = svgEl.querySelector('#hover-dot-total');
  const dotContrib = svgEl.querySelector('#hover-dot-contrib');

  function showHover(event) {
    const box = svgEl.getBoundingClientRect();
    const ratio = box.width ? width / box.width : 1;   // por si el SVG se achicó
    const x = (event.clientX - box.left) * ratio;
    let month = Math.round(((x - margin.left) / plotWidth) * totalMonths);
    month = Math.min(totalMonths, Math.max(0, month));

    const p = points[month];
    const a = splitAmounts(p, r.decimals);
    const px = xOf(month);

    hover.style.display = 'inline';
    hoverLine.setAttribute('x1', px);
    hoverLine.setAttribute('x2', px);
    dotTotal.setAttribute('cx', px);
    dotTotal.setAttribute('cy', yOf(p.balance));
    dotContrib.setAttribute('cx', px);
    dotContrib.setAttribute('cy', yOf(p.contributed));

    els.tooltip.innerHTML =
      '<strong>' + (month === 0 ? 'Inicio' : elapsedLabel(month)) + '</strong>' +
      '<div class="row"><span>Aportado</span><span>' + formatMoney(a.contributed, r.decimals) + '</span></div>' +
      '<div class="row"><span>Intereses</span><span>' + formatMoney(a.interest, r.decimals) + '</span></div>' +
      '<div class="row"><span>Total</span><span><strong>' + formatMoney(a.total, r.decimals) + '</strong></span></div>';
    els.tooltip.hidden = false;

    // El cuadro se coloca a la derecha de la línea, o a la izquierda si no entra
    const tipWidth = els.tooltip.offsetWidth;
    let left = px + 12;
    if (left + tipWidth > width) left = px - tipWidth - 12;
    els.tooltip.style.left = Math.max(0, left) + 'px';
  }

  function hideHover() {
    hover.style.display = 'none';
    els.tooltip.hidden = true;
  }

  overlay.addEventListener('pointermove', showHover);
  overlay.addEventListener('pointerdown', showHover);
  overlay.addEventListener('pointercancel', hideHover);
  overlay.addEventListener('pointerleave', (event) => {
    // En pantallas táctiles el cuadro queda visible hasta tocar otra cosa
    if (event.pointerType === 'mouse') hideHover();
  });

}

/** Vuelve a dibujar el gráfico si cambia el ancho disponible (girar el teléfono, etc.). */
function handleResize() {
  const width = Math.floor(els.chart.clientWidth);
  if (state.result && width && Math.abs(width - state.chartWidth) > 1) {
    drawChart();
  }
}


/* ==========================================================================
   8. ACCIONES DE LOS BOTONES Y EVENTOS
   ========================================================================== */

/** Cambia el símbolo de moneda que aparece dentro de los campos. */
function updateCurrencySymbols() {
  const symbol = currencySymbol();
  document.querySelectorAll('[data-currency-symbol]').forEach((el) => {
    el.textContent = symbol;
  });
}

/** Botón "Calcular": valida, calcula y muestra todo. */
function calculate() {
  clearErrors();

  const check = readAndValidate();
  const invalidKeys = FIELD_KEYS.filter((key) => check.errors[key]);

  if (invalidKeys.length > 0) {
    invalidKeys.forEach((key) => showError(key, check.errors[key]));
    els[invalidKeys[0]].focus();   // lleva el cursor al primer campo con error
    return;
  }

  const sim = simulate(check.values);
  const finalBalance = sim.points[sim.points.length - 1].balance;

  // Protección: si los números son gigantescos, se pide bajar algún valor
  if (!Number.isFinite(finalBalance) || finalBalance > LIMITS.maxResult) {
    hideResults();
    els.formError.textContent = 'Con estos valores el resultado es demasiado grande para mostrarse. Probá con una tasa o un período menor.';
    return;
  }

  state.result = {
    inputs: check.values,
    points: sim.points,
    totalMonths: sim.totalMonths,
    // Si el monto final es chico, se muestran centavos
    decimals: finalBalance < 1000 ? 2 : 0
  };

  els.results.hidden = false;   // primero se muestra la sección (el gráfico necesita medir su ancho)
  renderAll();
  scrollToResults();
}

/** Botón "Limpiar": deja todo como al principio. */
function clearAll() {
  els.form.reset();              // vacía los campos y restablece Mensual / Mensual
  els.currency.value = 'ARS';
  clearErrors();
  hideResults();
  updateCurrencySymbols();
  els.initial.focus();
}

/** Botón "Probar este ejemplo": carga los datos del ejemplo y calcula. */
function loadExample() {
  els.initial.value = '100.000';
  els.contribution.value = '50.000';
  $('freq-monthly').checked = true;
  els.rate.value = '8';
  els.years.value = '10';
  els.compounding.value = '12';
  calculate();
}

// Al enviar el formulario (botón "Calcular" o tecla Enter)
els.form.addEventListener('submit', (event) => {
  event.preventDefault();   // evita que la página se recargue
  calculate();
});

els.btnClear.addEventListener('click', clearAll);
els.btnExample.addEventListener('click', loadExample);

// Al cambiar de moneda: cambia el símbolo y se redibuja el resultado (sin convertir nada)
els.currency.addEventListener('change', () => {
  updateCurrencySymbols();
  if (state.result) renderAll();
});

// Al escribir en un campo, se borra su mensaje de error
FIELD_KEYS.forEach((key) => {
  els[key].addEventListener('input', () => {
    showError(key, '');
    els.formError.textContent = '';
  });
});

// Al salir de un campo de dinero, se le da formato (1250000 -> 1.250.000)
[els.initial, els.contribution].forEach((input) => {
  input.addEventListener('blur', () => {
    const n = parseNumber(input.value, true);
    if (Number.isFinite(n) && n >= 0 && n <= LIMITS.maxMoney) {
      input.value = formatFlexible(n, 2);
    }
  });
});

// Tocar fuera del gráfico cierra el cuadro de valores
document.addEventListener('pointerdown', (event) => {
  if (els.chart.contains(event.target)) return;
  const hover = els.chart.querySelector('#hover');
  if (hover) hover.style.display = 'none';
  els.tooltip.hidden = true;
});

// Redibujar el gráfico si cambia el ancho de la pantalla
if ('ResizeObserver' in window) {
  new ResizeObserver(handleResize).observe(els.chart);
} else {
  window.addEventListener('resize', handleResize);
}

// Estado inicial
updateCurrencySymbols();
els.year.textContent = new Date().getFullYear();

// Funciones disponibles en la consola del navegador, solo para hacer pruebas
window.__calculadora = { parseNumber, formatFixed, formatFlexible, simulate };
