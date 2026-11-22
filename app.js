/* رصد الأبحاث المشبوهة — كل التحليل يجري في المتصفح باستخدام بيانات مفتوحة (OpenAlex + ORCID) */
'use strict';

const OPENALEX = 'https://api.openalex.org';
const ORCID = 'https://pub.orcid.org/v3.0';

/* ---------- قوائم مرجعية ---------- */

// "عبارات معذّبة": صياغات ناتجة عن أدوات إعادة الصياغة الآلية لإخفاء السرقة العلمية
// (مأخوذة من أعمال Cabanac وآخرين، Problematic Paper Screener)
const TORTURED_PHRASES = {
  'counterfeit consciousness': 'artificial intelligence',
  'computerized reasoning': 'artificial intelligence',
  'man-made consciousness': 'artificial intelligence',
  'profound learning': 'deep learning',
  'profound neural organization': 'deep neural network',
  'fake neural organization': 'artificial neural network',
  'counterfeit neural organization': 'artificial neural network',
  'neural organization': 'neural network',
  'irregular woodland': 'random forest',
  'arbitrary woodland': 'random forest',
  'choice tree': 'decision tree',
  'help vector machine': 'support vector machine',
  'backing vector machine': 'support vector machine',
  'colossal information': 'big data',
  'enormous information': 'big data',
  'large information': 'big data',
  'cloud figuring': 'cloud computing',
  'haze figuring': 'fog computing',
  'web of things': 'internet of things',
  'remote sensor organization': 'wireless sensor network',
  'flag to commotion': 'signal to noise',
  'sign to commotion': 'signal to noise',
  'mean square blunder': 'mean square error',
  'root mean square blunder': 'root mean square error',
  'straight relapse': 'linear regression',
  'strategic relapse': 'logistic regression',
  'subterranean insect state': 'ant colony',
  'molecule swarm': 'particle swarm',
  'bosom malignant growth': 'breast cancer',
  'bosom disease': 'breast cancer',
  'lung malignant growth': 'lung cancer',
  'prostate malignant growth': 'prostate cancer',
  'malignant growth': 'cancer',
  'kidney disappointment': 'kidney failure',
  'heart disappointment': 'heart failure',
  'dark opening': 'black hole',
  'discourse acknowledgment': 'speech recognition',
  'picture acknowledgment': 'image recognition',
  'face acknowledgment': 'face recognition',
  'design acknowledgment': 'pattern recognition',
  'shrewd city': 'smart city',
  'keen city': 'smart city',
  'savvy matrix': 'smart grid',
  'sun based vitality': 'solar energy',
  'sustainable power source': 'renewable energy',
  'worldwide temperature alteration': 'global warming',
  'parcel misfortune': 'packet loss',
  'irregular access': 'random access',
  'gullible bayes': 'naive bayes',
  'k-closest neighbor': 'k-nearest neighbor',
  'blunder rate': 'error rate',
};

// مجلات سُجّلت فيها سحوبات جماعية للأوراق (مثل سحوبات Hindawi/Wiley 2023 لأوراق "مصانع الأبحاث")
// وجود ورقة فيها ليس دليلاً بذاته، لكنه يستدعي التدقيق.
const MASS_RETRACTION_VENUES = [
  'computational intelligence and neuroscience',
  'journal of healthcare engineering',
  'computational and mathematical methods in medicine',
  'wireless communications and mobile computing',
  'mobile information systems',
  'security and communication networks',
  'scientific programming',
  'journal of environmental and public health',
  'evidence-based complementary and alternative medicine',
  'contrast media & molecular imaging',
  'contrast media and molecular imaging',
  'mathematical problems in engineering',
  'biomed research international',
  'oxidative medicine and cellular longevity',
  'journal of sensors',
  'journal of nanomaterials',
  'occupational therapy international',
  'computational and mathematical methods',
  'journal of physics: conference series',
  'iop conference series: materials science and engineering',
];

// معيار Ioannidis وآخرين (Nature 2018): الباحث "مفرط الإنتاج" من ينشر أكثر من 72 ورقة في السنة (ورقة كل 5 أيام)
const HYPERPROLIFIC = 72;

/* ---------- أدوات عامة ---------- */

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => (n ?? 0).toLocaleString('en-US');
const shortId = (id) => String(id || '').split('/').pop();
const pct = (x) => (x * 100).toFixed(1) + '%';

let mode = 'author';

function setStatus(msg, isError = false) {
  const el = $('#status');
  if (!msg) { el.hidden = true; return; }
  el.hidden = false;
  el.className = 'status' + (isError ? ' error' : '');
  el.textContent = msg;
}

function storage(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key) || '';
    localStorage.setItem(key, val);
  } catch { return ''; }
}

async function oa(path, params = {}) {
  const url = new URL(OPENALEX + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  const key = $('#apiKey').value.trim();
  if (key) url.searchParams.set('api_key', key);
  const res = await fetch(url);
  if (res.status === 429) throw new Error('تجاوزت حدّ الطلبات المجاني في OpenAlex. أضف مفتاح API مجاني من الإعدادات وأعد المحاولة.');
  if (res.status === 404) throw new Error('لم يتم العثور على السجل في OpenAlex.');
  if (!res.ok) throw new Error('خطأ من OpenAlex: ' + res.status);
  return res.json();
}

async function orcidEmployments(orcid) {
  const id = shortId(orcid);
  try {
    const res = await fetch(`${ORCID}/${id}/employments`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    const out = [];
    for (const g of data['affiliation-group'] || []) {
      for (const s of g.summaries || []) {
        const e = s['employment-summary'];
        if (!e) continue;
        out.push({
          role: e['role-title'] || '',
          dept: e['department-name'] || '',
          org: e.organization?.name || '',
          country: e.organization?.address?.country || '',
          start: e['start-date']?.year?.value || '',
          end: e['end-date']?.year?.value || '',
        });
      }
    }
    // الحالية أولاً ثم الأحدث
    out.sort((a, b) => (a.end ? 1 : 0) - (b.end ? 1 : 0) || (b.start || 0) - (a.start || 0));
    return out;
  } catch {
    return null;
  }
}

function abstractText(inv) {
  if (!inv) return '';
  const words = [];
  for (const [w, positions] of Object.entries(inv)) for (const p of positions) words[p] = w;
  return words.join(' ');
}

function lastInstitutions(author) {
  return author.last_known_institutions || (author.last_known_institution ? [author.last_known_institution] : []);
}

function instLabel(i) {
  return `${i.display_name}${i.country_code ? ' (' + i.country_code + ')' : ''}`;
}

/* ---------- البحث ---------- */

async function onSearch(e) {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (!q) return;
  $('#results').innerHTML = '';
  const btn = $('#searchForm .btn');
  btn.disabled = true;
  try {
    if (mode === 'author') await searchAuthors(q);
    else await searchInstitutions(q);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

async function searchAuthors(q) {
  const orcid = q.match(/\d{4}-\d{4}-\d{4}-\d{3}[\dX]/i);
  if (orcid) { setStatus('جارٍ جلب الباحث عبر ORCID…'); return analyzeAuthor('orcid:' + orcid[0].toUpperCase()); }
  if (/^A\d+$/i.test(q)) return analyzeAuthor(q.toUpperCase());

  setStatus('جارٍ البحث عن الباحث…');
  const data = await oa('/authors', { search: q, 'per-page': 15 });
  setStatus('');
  if (!data.results.length) { setStatus('لا توجد نتائج. جرّب كتابة الاسم بالإنجليزية كما يظهر في الأبحاث.', true); return; }
  $('#results').innerHTML = `
    <section class="card">
      <h3>اختر الباحث المقصود</h3>
      <p class="muted">قد يتكرّر الاسم لعدة أشخاص — تحقّق من المؤسسة وعدد الأوراق.</p>
      <ul class="candidates">
        ${data.results.map((a) => `
          <li>
            <div>
              <b>${esc(a.display_name)}</b>
              <div class="muted">${esc(lastInstitutions(a).map(instLabel).join(' · ') || 'مؤسسة غير معروفة')}</div>
              <div class="muted">${num(a.works_count)} ورقة · ${num(a.cited_by_count)} استشهاد${a.orcid ? ' · ORCID ✓' : ''}</div>
            </div>
            <button class="btn small" data-author="${esc(shortId(a.id))}">فحص</button>
          </li>`).join('')}
      </ul>
    </section>`;
}

async function searchInstitutions(q) {
  setStatus('جارٍ البحث عن المؤسسة…');
  const data = await oa('/institutions', { search: q, 'per-page': 10 });
  setStatus('');
  if (!data.results.length) { setStatus('لا توجد نتائج. جرّب الاسم بالإنجليزية مثل King Saud University.', true); return; }
  $('#results').innerHTML = `
    <section class="card">
      <h3>اختر المؤسسة</h3>
      <ul class="candidates">
        ${data.results.map((i) => `
          <li>
            <div>
              <b>${esc(i.display_name)}</b>
              <div class="muted">${esc(i.geo?.city || '')} ${esc(i.country_code || '')} · ${num(i.works_count)} ورقة</div>
            </div>
            <button class="btn small" data-inst="${esc(shortId(i.id))}">فحص</button>
          </li>`).join('')}
      </ul>
    </section>`;
}

/* ---------- تحليل الباحث ---------- */

async function fetchAllWorks(authorId, max) {
  const select = 'id,doi,title,type,publication_year,is_retracted,primary_location,authorships,referenced_works,abstract_inverted_index,primary_topic,cited_by_count';
  const works = [];
  let cursor = '*';
  while (cursor && works.length < max) {
    const page = await oa('/works', { filter: `author.id:${authorId}`, 'per-page': 200, cursor, select, sort: 'publication_year:desc' });
    works.push(...page.results);
    cursor = page.meta.next_cursor;
    setStatus(`جارٍ جلب الأوراق… ${works.length} من ${num(page.meta.count)}`);
    if (!page.results.length) break;
  }
  return works.slice(0, max);
}

async function analyzeAuthor(idOrOrcid) {
  setStatus('جارٍ جلب ملف الباحث…');
  const author = await oa('/authors/' + idOrOrcid);
  const authorId = shortId(author.id);
  const max = Number($('#maxWorks').value);
  const [works, employments] = await Promise.all([
    fetchAllWorks(authorId, max),
    author.orcid ? orcidEmployments(author.orcid) : Promise.resolve(null),
  ]);
  setStatus('');
  const report = buildAuthorReport(author, works);
  renderAuthor(author, works, report, employments);
}

// الأنواع التي تُعدّ "أوراقاً" فعلية (نستبعد المسودات preprints ومجموعات البيانات والمستودعات مثل arXiv و Kaggle)
const PAPER_TYPES = new Set(['article', 'conference-paper', 'review', 'book-chapter', 'letter']);

function realPapers(works) {
  const seen = new Set();
  return works.filter((w) => {
    if (w.type && !PAPER_TYPES.has(w.type)) return false;
    if (w.primary_location?.source?.type === 'repository') return false;
    // إزالة النسخ المكررة لنفس الورقة
    const key = (w.title || w.id).toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildAuthorReport(author, allWorks) {
  const authorUrl = author.id;
  const flags = [];
  const ownIds = new Set(allWorks.map((w) => w.id));
  const truncated = allWorks.length < (author.works_count || 0);
  const works = realPapers(allWorks);
  const excluded = allWorks.length - works.length;

  // 1) الإنتاج السنوي (أوراق فعلية فقط، بدون مسودات أو تكرار)
  const years = {};
  for (const w of works) if (w.publication_year) years[w.publication_year] = (years[w.publication_year] || 0) + 1;
  let yearList = Object.keys(years).map(Number).sort((a, b) => a - b);
  // عند اقتطاع الأوراق تكون أقدم سنة مجلوبة ناقصة، فنستبعدها
  if (truncated && yearList.length > 1) { delete years[yearList[0]]; yearList = yearList.slice(1); }
  const hyperYears = yearList.filter((y) => years[y] > HYPERPROLIFIC);
  const authorsPerPaper = works.map((w) => (w.authorships || []).length).sort((a, b) => a - b);
  const medianAuthors = authorsPerPaper.length ? authorsPerPaper[Math.floor(authorsPerPaper.length / 2)] : 0;
  const bigCollab = medianAuthors >= 50;

  if (hyperYears.length) {
    const peak = Math.max(...hyperYears.map((y) => years[y]));
    flags.push({
      level: bigCollab ? 'info' : 'high',
      title: 'نشر مفرط (Hyperprolific)',
      text: `نشر أكثر من ${HYPERPROLIFIC} ورقة في ${hyperYears.length} سنة (${hyperYears.join('، ')})، وبلغت الذروة ${peak} ورقة/سنة — أي ورقة كل ${(365 / peak).toFixed(1)} يوم.` +
        (bigCollab ? ` لكن الوسيط ${medianAuthors} مؤلفاً لكل ورقة، ما يدل على تعاونات ضخمة (مثل فيزياء الجسيمات) وهذا شائع ومقبول هناك.` : ''),
    });
  }

  // قفزة مفاجئة في الإنتاج
  const spikes = [];
  for (let i = 3; i < yearList.length; i++) {
    const y = yearList[i];
    const prev = [years[yearList[i - 1]], years[yearList[i - 2]], years[yearList[i - 3]]].sort((a, b) => a - b)[1];
    if (years[y] >= 15 && years[y] >= Math.max(prev, 2) * 3) spikes.push(`${y}: ${years[y]} (مقابل ~${prev} قبلها)`);
  }
  if (spikes.length) {
    flags.push({ level: 'med', title: 'قفزة مفاجئة في عدد الأوراق', text: `تضاعف الإنتاج 3 مرات أو أكثر خلال سنة: ${spikes.join(' · ')}. القفزات الحادة قد ترتبط بشراء التأليف أو مصانع الأبحاث، أو بتغيير المنصب/الانضمام لفريق كبير.` });
  }

  // 2) أوراق مسحوبة
  const retracted = allWorks.filter((w) => w.is_retracted);
  if (retracted.length) {
    flags.push({ level: 'high', title: `أوراق مسحوبة (${retracted.length})`, text: 'أوراق سحبتها المجلات رسمياً (بيانات Retraction Watch/Crossref). راجع إشعار السحب لمعرفة السبب: احتيال، تلاعب بالتحكيم، سرقة، أو خطأ نزيه.' });
  }

  // 3) عبارات معذّبة
  const tortured = [];
  for (const w of allWorks) {
    const text = ((w.title || '') + ' ' + abstractText(w.abstract_inverted_index)).toLowerCase();
    const hits = Object.keys(TORTURED_PHRASES).filter((p) => text.includes(p));
    // تجنب التكرار: إن وُجدت "bosom malignant growth" فلا داعي لـ "malignant growth"
    const filtered = hits.filter((h) => !hits.some((o) => o !== h && o.includes(h)));
    if (filtered.length) tortured.push({ work: w, phrases: filtered });
  }
  if (tortured.length) {
    flags.push({ level: 'high', title: `عبارات معذّبة (Tortured phrases) في ${tortured.length} ورقة`, text: 'صياغات غريبة مثل "counterfeit consciousness" بدل "artificial intelligence" تنتج عن أدوات إعادة الصياغة الآلية لإخفاء النقل، وهي من أقوى مؤشرات مصانع الأبحاث.' });
  }

  // 4) مجلات سحوبات جماعية
  const venueCounts = {};
  const massVenue = [];
  for (const w of works) {
    const v = w.primary_location?.source?.display_name;
    if (!v) continue;
    venueCounts[v] = (venueCounts[v] || 0) + 1;
    if (MASS_RETRACTION_VENUES.includes(v.toLowerCase())) massVenue.push(w);
  }
  if (massVenue.length) {
    flags.push({ level: massVenue.length >= 5 ? 'high' : 'med', title: `أوراق في مجلات شهدت سحوبات جماعية (${massVenue.length})`, text: 'مجلات أو سلاسل مؤتمرات سحبت آلاف الأوراق بسبب مصانع الأبحاث والتحكيم المزيّف (مثل أعداد Hindawi الخاصة). ليست دليلاً بذاتها، لكنها تستحق المراجعة.' });
  }
  const topVenues = Object.entries(venueCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (works.length >= 20 && topVenues.length && topVenues[0][1] / works.length > 0.3) {
    flags.push({ level: 'med', title: 'تركّز النشر في مجلة واحدة', text: `${pct(topVenues[0][1] / works.length)} من الأوراق في "${topVenues[0][0]}". التركّز الشديد قد يشير إلى علاقة خاصة بهيئة التحرير أو أعداد خاصة.` });
  }

  // 5) الاستشهاد الذاتي (المراجع التي تشير لأوراق الباحث نفسه)
  let totalRefs = 0, selfRefs = 0;
  for (const w of allWorks) {
    for (const r of w.referenced_works || []) { totalRefs++; if (ownIds.has(r)) selfRefs++; }
  }
  const selfRate = totalRefs ? selfRefs / totalRefs : 0;
  if (totalRefs >= 100 && selfRate > 0.15) {
    flags.push({ level: selfRate > 0.25 ? 'high' : 'med', title: `استشهاد ذاتي مرتفع (${pct(selfRate)})`, text: `${num(selfRefs)} من أصل ${num(totalRefs)} مرجعاً في أوراقه تشير إلى أوراقه هو. المعدل المعتاد أقل من ~10–15%. الاستشهاد الذاتي المفرط يضخّم مؤشر h اصطناعياً.` + (truncated ? ' (محسوب على الأوراق المجلوبة فقط، والرقم الحقيقي قد يكون أعلى).' : '') });
  }

  // 6) الانتماءات: مؤسسات الباحث كما تظهر في أوراقه، والانتماء المزدوج بين دول مختلفة
  const instStats = {};
  let multiCountry = 0;
  const multiCountryRecent = [];
  const currentYear = new Date().getFullYear();
  for (const w of works) {
    const me = (w.authorships || []).find((a) => a.author?.id === authorUrl);
    if (!me) continue;
    const countries = new Set();
    for (const inst of me.institutions || []) {
      const k = inst.id || inst.display_name;
      if (!k) continue;
      const s = instStats[k] || (instStats[k] = { name: inst.display_name, country: inst.country_code, count: 0, min: 9999, max: 0 });
      s.count++;
      if (w.publication_year) { s.min = Math.min(s.min, w.publication_year); s.max = Math.max(s.max, w.publication_year); }
      if (inst.country_code) countries.add(inst.country_code);
    }
    if (countries.size >= 2) {
      multiCountry++;
      if (w.publication_year >= currentYear - 3) multiCountryRecent.push(w);
    }
  }
  const instList = Object.values(instStats).sort((a, b) => b.count - a.count);
  if (works.length >= 10 && multiCountry / works.length > 0.25) {
    flags.push({ level: multiCountryRecent.length >= 10 ? 'high' : 'med', title: `انتماءات مزدوجة في دول مختلفة (${multiCountry} ورقة)`, text: `يذكر الباحث في ${pct(multiCountry / works.length)} من أوراقه انتماءً لمؤسستين أو أكثر في دول مختلفة. هذا النمط قد يكون تعاوناً مشروعاً، لكنه أيضاً علامة معروفة على "الانتماء مقابل المال" لرفع تصنيف الجامعات (خصوصاً بين الباحثين الأكثر استشهاداً).` });
  }

  // 7) تشتّت التخصصات
  const fields = {};
  for (const w of works) { const f = w.primary_topic?.field?.display_name; if (f) fields[f] = (fields[f] || 0) + 1; }
  const fieldList = Object.entries(fields).sort((a, b) => b[1] - a[1]);
  const fieldTotal = fieldList.reduce((s, [, n]) => s + n, 0);
  if (fieldTotal >= 30 && fieldList.length >= 7 && fieldList[0][1] / fieldTotal < 0.4) {
    flags.push({ level: 'med', title: `تشتّت غير معتاد في التخصصات (${fieldList.length} مجالات)`, text: 'النشر في مجالات متباعدة جداً دون تخصص واضح قد يدل على إضافة الاسم كمؤلف شرفي أو شراء مقاعد تأليف.' });
  }

  const score = Math.min(100, flags.reduce((s, f) => s + (f.level === 'high' ? 25 : f.level === 'med' ? 10 : 0), 0));
  return { flags, score, years, yearList, retracted, tortured, massVenue, topVenues, selfRate, selfRefs, totalRefs, instList, fieldList, fieldTotal, medianAuthors, truncated, multiCountry, excluded, paperCount: works.length };
}

/* ---------- العرض ---------- */

function paperRow(w, extra = '') {
  const doi = w.doi ? w.doi.replace('https://doi.org/', '') : '';
  return `<tr>
    <td>${esc(w.publication_year || '')}</td>
    <td>${esc(w.title || '(بدون عنوان)')}${extra}<div class="muted">${esc(w.primary_location?.source?.display_name || '')}</div></td>
    <td class="links">
      ${w.doi ? `<a href="${esc(w.doi)}" target="_blank" rel="noopener">DOI</a>` : ''}
      ${doi ? `<a href="https://pubpeer.com/search?q=${encodeURIComponent(doi)}" target="_blank" rel="noopener">PubPeer</a>` : ''}
      <a href="https://openalex.org/${esc(shortId(w.id))}" target="_blank" rel="noopener">OpenAlex</a>
    </td>
  </tr>`;
}

function table(head, rows) {
  return `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderAuthor(author, works, r, employments) {
  const level = r.score >= 50 ? 'high' : r.score >= 20 ? 'med' : 'low';
  const levelText = { high: 'يستحق التدقيق', med: 'مؤشرات متوسطة', low: 'لا مؤشرات بارزة' }[level];
  const lastInst = lastInstitutions(author);
  const maxYear = Math.max(1, ...r.yearList.map((y) => r.years[y]));
  const recentYears = r.yearList.slice(-25);

  const position = employments && employments.length
    ? table(['المنصب', 'القسم', 'المؤسسة', 'الفترة'], employments.map((e) => `<tr>
        <td><b>${esc(e.role || '—')}</b></td><td>${esc(e.dept || '—')}</td><td>${esc(e.org)} ${e.country ? `<span class="muted">(${esc(e.country)})</span>` : ''}</td>
        <td>${esc(e.start || '?')} – ${e.end ? esc(e.end) : '<b>حالياً</b>'}</td></tr>`).join(''))
    : `<p class="muted">${author.orcid ? 'لم يسجّل الباحث بيانات وظيفية عامة في ORCID.' : 'لا يوجد حساب ORCID مرتبط.'} المؤسسة الحالية حسب الأوراق: <b>${esc(lastInst.map(instLabel).join(' · ') || 'غير معروفة')}</b>.</p>`;

  const searchName = encodeURIComponent(`"${author.display_name}" ${lastInst[0]?.display_name || ''} professor`);

  $('#results').innerHTML = `
  ${reportHeader('تقرير فحص باحث', author.display_name)}
  <section class="card">
    <div class="profile-head">
      <div>
        <h2>${esc(author.display_name)}</h2>
        <div class="muted">${esc(lastInst.map(instLabel).join(' · ') || '')}</div>
        <div class="links muted">
          <a href="https://openalex.org/${esc(shortId(author.id))}" target="_blank" rel="noopener">OpenAlex</a>
          ${author.orcid ? `<a href="${esc(author.orcid)}" target="_blank" rel="noopener">ORCID</a>` : ''}
          <a href="https://scholar.google.com/scholar?q=${encodeURIComponent('author:"' + author.display_name + '"')}" target="_blank" rel="noopener">Google Scholar</a>
          <a href="https://pubpeer.com/search?q=${encodeURIComponent(author.display_name)}" target="_blank" rel="noopener">PubPeer</a>
          <a href="https://www.google.com/search?q=${searchName}" target="_blank" rel="noopener">البحث عن صفحته الجامعية</a>
        </div>
      </div>
      <div class="score ${level}"><b>${r.score}</b>${levelText}</div>
    </div>
    <div class="stats">
      <div class="stat"><span>الأوراق</span><b>${num(author.works_count)}</b></div>
      <div class="stat"><span>الاستشهادات</span><b>${num(author.cited_by_count)}</b></div>
      <div class="stat"><span>مؤشر h</span><b>${num(author.summary_stats?.h_index)}</b></div>
      <div class="stat"><span>أوراق مسحوبة</span><b>${num(r.retracted.length)}</b></div>
      <div class="stat"><span>استشهاد ذاتي</span><b>${r.totalRefs ? pct(r.selfRate) : '—'}</b></div>
      <div class="stat"><span>وسيط المؤلفين/ورقة</span><b>${num(r.medianAuthors)}</b></div>
    </div>
    ${r.excluded ? `<p class="muted">استُبعد ${num(r.excluded)} عنصراً من الإحصاءات (مسودات preprint، مجموعات بيانات، نسخ مكررة) وبقيت ${num(r.paperCount)} ورقة فعلية.</p>` : ''}
    ${r.truncated ? `<p class="muted">تم تحليل ${num(works.length)} ورقة (الأحدث) من أصل ${num(author.works_count)}. ارفع الحد من الإعدادات لتحليل أشمل.</p>` : ''}
  </section>

  <section class="card">
    <h3>🎓 المنصب الأكاديمي</h3>
    ${position}
    <p class="muted">المنصب مأخوذ من ORCID (يُدخله الباحث بنفسه). للتأكد راجع صفحة الباحث في موقع الجامعة.</p>
  </section>

  <section class="card">
    <h3>🚩 المؤشرات</h3>
    ${r.flags.length ? r.flags.map((f) => `<div class="flag ${f.level}"><h4>${esc(f.title)} <span class="tag ${f.level}">${{ high: 'مرتفع', med: 'متوسط', info: 'معلومة' }[f.level]}</span></h4><p>${esc(f.text)}</p></div>`).join('') : '<p>لم تُرصد مؤشرات بارزة في البيانات المتاحة.</p>'}
  </section>

  <section class="card">
    <h3>📈 الإنتاج السنوي</h3>
    <div class="bars">${recentYears.map((y) => `<div class="bar ${r.years[y] > HYPERPROLIFIC ? 'hot' : ''}" style="height:${(r.years[y] / maxYear) * 100}%" title="${y}: ${r.years[y]}"></div>`).join('')}</div>
    <div class="bar-labels">${recentYears.map((y) => `<span title="${y}: ${r.years[y]}">${String(y).slice(2)}</span>`).join('')}</div>
    <p class="muted">الأوراق الفعلية فقط (بدون مسودات أو تكرار). الأعمدة الحمراء: سنوات تجاوز فيها ${HYPERPROLIFIC} ورقة.</p>
  </section>

  ${r.retracted.length ? `<section class="card"><h3>❌ الأوراق المسحوبة</h3>${table(['السنة', 'العنوان', 'روابط'], r.retracted.map((w) => paperRow(w)).join(''))}</section>` : ''}

  ${r.tortured.length ? `<section class="card"><h3>🌀 أوراق بها عبارات معذّبة</h3>${table(['السنة', 'العنوان', 'روابط'], r.tortured.slice(0, 50).map((t) => paperRow(t.work, `<div>${t.phrases.map((p) => `<span class="tag high">"${esc(p)}" ← ${esc(TORTURED_PHRASES[p])}</span>`).join(' ')}</div>`)).join(''))}</section>` : ''}

  ${r.massVenue.length ? `<section class="card"><h3>⚠️ أوراق في مجلات شهدت سحوبات جماعية</h3>${table(['السنة', 'العنوان', 'روابط'], r.massVenue.slice(0, 50).map((w) => paperRow(w)).join(''))}</section>` : ''}

  <section class="card">
    <h3>🏛️ الانتماءات كما تظهر في الأوراق</h3>
    ${r.instList.length ? table(['المؤسسة', 'الدولة', 'عدد الأوراق', 'الفترة'], r.instList.slice(0, 15).map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.country || '')}</td><td>${num(i.count)}</td><td>${i.min < 9999 ? `${i.min} – ${i.max}` : ''}</td></tr>`).join('')) : '<p class="muted">لا توجد بيانات.</p>'}
    <p class="muted">انتبه لمؤسسة ثانوية تظهر فجأة بأعداد كبيرة في سنوات قليلة، خصوصاً إن كانت في دولة غير دولة عمل الباحث.</p>
  </section>

  <section class="card">
    <h3>📚 أكثر المجلات نشراً فيها</h3>
    ${table(['المجلة', 'عدد الأوراق'], r.topVenues.map(([v, n]) => `<tr><td>${esc(v)}${MASS_RETRACTION_VENUES.includes(v.toLowerCase()) ? ' <span class="tag med">سحوبات جماعية</span>' : ''}</td><td>${n}</td></tr>`).join(''))}
  </section>

  <section class="card">
    <h3>🧭 المجالات</h3>
    ${table(['المجال', 'النسبة'], r.fieldList.slice(0, 10).map(([f, n]) => `<tr><td>${esc(f)}</td><td>${pct(n / r.fieldTotal)}</td></tr>`).join(''))}
  </section>`;
}

/* ---------- تحليل المؤسسة ---------- */

async function analyzeInstitution(instId) {
  setStatus('جارٍ تحليل المؤسسة…');
  const inst = await oa('/institutions/' + instId);
  const id = shortId(inst.id);
  const year = new Date().getFullYear();
  const since = `${year - 3}-01-01`;

  const [retractedMeta, topRecent, topAuthors] = await Promise.all([
    oa('/works', { filter: `institutions.id:${id},is_retracted:true`, 'per-page': 25, select: 'id,doi,title,publication_year,primary_location', sort: 'publication_year:desc' }),
    oa('/works', { filter: `institutions.id:${id},from_publication_date:${since}`, group_by: 'authorships.author.id', 'per-page': 30 }).catch(() => null),
    oa('/authors', { filter: `last_known_institutions.id:${id}`, sort: 'works_count:desc', 'per-page': 30, select: 'id,display_name,works_count,cited_by_count,counts_by_year,last_known_institutions,summary_stats' }).catch(() => null),
  ]);

  // أكثر المؤلفين نشراً باسم المؤسسة خلال 3 سنوات، ومعرفة ما إذا كانت المؤسسة انتماءهم الأساسي
  let affRows = [];
  if (topRecent?.group_by?.length) {
    const groups = topRecent.group_by.filter((g) => g.key && g.key !== 'unknown').slice(0, 30);
    const ids = groups.map((g) => shortId(g.key));
    const authors = ids.length ? await oa('/authors', { filter: `id:${ids.join('|')}`, 'per-page': 50, select: 'id,display_name,last_known_institutions,works_count' }) : { results: [] };
    const byId = Object.fromEntries(authors.results.map((a) => [shortId(a.id), a]));
    affRows = groups.map((g) => {
      const a = byId[shortId(g.key)];
      const lki = a ? lastInstitutions(a) : [];
      const primaryHere = lki.length && shortId(lki[0].id) === id;
      const listedHere = lki.some((i) => shortId(i.id) === id);
      const foreign = lki.filter((i) => shortId(i.id) !== id && i.country_code && i.country_code !== inst.country_code);
      return { id: shortId(g.key), name: a?.display_name || g.key_display_name, count: g.count, lki, primaryHere, listedHere, foreign };
    });
  }

  const prolific = (topAuthors?.results || []).map((a) => {
    const recent = (a.counts_by_year || []).filter((c) => c.year >= year - 5);
    const peak = recent.reduce((m, c) => (c.works_count > m.works_count ? c : m), { works_count: 0, year: '' });
    return { a, peak };
  }).sort((x, y) => y.peak.works_count - x.peak.works_count);

  setStatus('');
  const suspiciousAff = affRows.filter((r) => !r.primaryHere && r.foreign.length);
  $('#results').innerHTML = `
  ${reportHeader('تقرير فحص مؤسسة', inst.display_name)}
  <section class="card">
    <div class="profile-head">
      <div>
        <h2>${esc(inst.display_name)}</h2>
        <div class="muted">${esc(inst.geo?.city || '')} ${esc(inst.country_code || '')} · <a href="https://openalex.org/${esc(id)}" target="_blank" rel="noopener">OpenAlex</a></div>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><span>الأوراق</span><b>${num(inst.works_count)}</b></div>
      <div class="stat"><span>الاستشهادات</span><b>${num(inst.cited_by_count)}</b></div>
      <div class="stat"><span>أوراق مسحوبة</span><b>${num(retractedMeta.meta.count)}</b></div>
      <div class="stat"><span>انتماءات ثانوية أجنبية (أعلى 30 ناشراً)</span><b>${suspiciousAff.length}</b></div>
    </div>
  </section>

  <section class="card">
    <h3>🌍 أكثر الباحثين نشراً باسم المؤسسة (آخر 3 سنوات)</h3>
    <p class="muted">إذا كان كثير من أكثر الناشرين باسم الجامعة يعملون أساساً في جامعات بدول أخرى، فهذا نمط "الانتماء الثانوي" الذي يُستخدم لرفع التصنيف.</p>
    ${affRows.length ? table(['الباحث', 'أوراق باسم المؤسسة', 'الانتماء الحالي', 'تقييم', ''], affRows.map((r) => `<tr>
      <td>${esc(r.name)}</td><td>${num(r.count)}</td>
      <td class="muted">${esc(r.lki.map(instLabel).join(' · ') || '—')}</td>
      <td>${r.primaryHere ? '<span class="tag info">أساسي</span>' : r.foreign.length ? '<span class="tag high">ثانوي/أجنبي</span>' : r.listedHere ? '<span class="tag med">مشترك</span>' : '<span class="tag med">غير مدرج حالياً</span>'}</td>
      <td><button class="btn small" data-author="${esc(r.id)}">فحص</button></td></tr>`).join('')) : '<p class="muted">لم تتوفر بيانات التجميع.</p>'}
  </section>

  <section class="card">
    <h3>⚡ أعلى ذروة إنتاج سنوي بين باحثي المؤسسة (آخر 5 سنوات)</h3>
    <p class="muted">أرقام تقريبية تشمل المسودات ومجموعات البيانات؛ اضغط "فحص" للحصول على العدد الدقيق للأوراق الفعلية.</p>
    ${prolific.length ? table(['الباحث', 'الذروة', 'السنة', 'إجمالي الأوراق', ''], prolific.map(({ a, peak }) => `<tr>
      <td>${esc(a.display_name)}</td>
      <td>${num(peak.works_count)} ${peak.works_count > HYPERPROLIFIC ? '<span class="tag high">مفرط</span>' : ''}</td>
      <td>${esc(peak.year)}</td><td>${num(a.works_count)}</td>
      <td><button class="btn small" data-author="${esc(shortId(a.id))}">فحص</button></td></tr>`).join('')) : '<p class="muted">لا توجد بيانات.</p>'}
  </section>

  <section class="card">
    <h3>❌ أحدث الأوراق المسحوبة المرتبطة بالمؤسسة</h3>
    ${retractedMeta.results.length ? table(['السنة', 'العنوان', 'روابط'], retractedMeta.results.map((w) => paperRow(w)).join('')) : '<p class="muted">لا توجد أوراق مسحوبة مسجّلة.</p>'}
  </section>`;
}

/* ---------- تقرير PDF ---------- */

let reportName = '';

function reportHeader(kind, name) {
  reportName = `${kind} - ${name}`;
  const date = new Date().toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' });
  return `
  <div class="toolbar no-print">
    <button class="btn" data-pdf="1">📄 تصدير التقرير PDF</button>
    <span class="muted">في نافذة الطباعة اختر "حفظ كـ PDF" (Save as PDF).</span>
  </div>
  <div class="print-only report-head">
    <h1>${esc(kind)}: ${esc(name)}</h1>
    <p>تاريخ التقرير: ${esc(date)} · المصادر: OpenAlex و ORCID و Retraction Watch</p>
    <p class="note">هذه مؤشرات آلية وإحصائية وليست حكماً أو اتهاماً. يجب التحقق يدوياً من المصادر الأصلية.</p>
  </div>`;
}

function exportPdf() {
  const prev = document.title;
  const day = new Date().toISOString().slice(0, 10);
  document.title = `${reportName} - ${day}`; // يُستخدم اسماً لملف PDF
  window.print();
  setTimeout(() => { document.title = prev; }, 1000);
}

/* ---------- الربط ---------- */

document.addEventListener('DOMContentLoaded', () => {
  $('#apiKey').value = storage('oa_key');
  $('#apiKey').addEventListener('change', () => storage('oa_key', $('#apiKey').value.trim()));
  $('#searchForm').addEventListener('submit', onSearch);

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    mode = t.dataset.mode;
    $('#q').placeholder = mode === 'author'
      ? 'اسم الباحث بالإنجليزية، أو رقم ORCID مثل 0000-0002-1825-0097'
      : 'اسم الجامعة بالإنجليزية، مثل King Abdulaziz University';
    $('#results').innerHTML = '';
    setStatus('');
  }));

  $('#results').addEventListener('click', async (e) => {
    if (e.target.closest('button[data-pdf]')) { exportPdf(); return; }
    const btn = e.target.closest('button[data-author], button[data-inst]');
    if (!btn) return;
    btn.disabled = true;
    try {
      if (btn.dataset.author) await analyzeAuthor(btn.dataset.author);
      else await analyzeInstitution(btn.dataset.inst);
      window.scrollTo({ top: $('#results').offsetTop - 10, behavior: 'smooth' });
    } catch (err) {
      setStatus(err.message, true);
      btn.disabled = false;
    }
  });
});
