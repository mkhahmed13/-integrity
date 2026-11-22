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

/* ---------- شرح المصطلحات ---------- */

const GLOSSARY = {
  score: {
    title: 'التقييم (من 0 إلى 100)',
    what: 'رقم يجمع كل المؤشرات اللي ظهرت للباحث: كل مؤشر "مرتفع" يضيف 25 نقطة، وكل مؤشر "متوسط" يضيف 10، والحد الأقصى 100.',
    why: 'يساعدك ترتّب الباحثين وتعرف مين تبدأ تدقق عليه أولاً.',
    normal: 'التقييم ليس حكماً. 50 أو أكثر يعني "يستحق التدقيق"، وأقل من 20 يعني لا شيء بارز. باحث نزيه قد يحصل على تقييم مرتفع بسبب طبيعة مجاله.',
  },
  position: {
    title: 'المنصب الأكاديمي',
    what: 'الرتبة الوظيفية للباحث (أستاذ، أستاذ مشارك، أستاذ مساعد…) والقسم والجامعة وفترة العمل.',
    why: 'تعرف مين صاحب الأبحاث فعلاً، وهل منصبه يتناسب مع حجم إنتاجه وانتماءاته.',
    normal: 'المعلومة من ORCID والباحث يكتبها بنفسه، فقد تكون قديمة أو ناقصة. تأكد من موقع الجامعة.',
  },
  hyperprolific: {
    title: 'نشر مفرط (Hyperprolific)',
    what: 'الباحث نشر أكثر من 72 ورقة في سنة واحدة، يعني ورقة كل 5 أيام تقريباً. هذا التعريف من دراسة منشورة في مجلة Nature سنة 2018.',
    why: 'من الصعب جداً أن يساهم شخص واحد مساهمة حقيقية في هذا العدد. قد يعني أن اسمه يُضاف لأوراق لم يعمل عليها (تأليف شرفي) أو أنه يشتري مقاعد تأليف.',
    normal: 'في المجالات اللي فيها فرق ضخمة (مثل فيزياء الجسيمات أو الدراسات الطبية الكبيرة) يكون في الورقة مئات المؤلفين، وهذا طبيعي هناك.',
  },
  spike: {
    title: 'قفزة مفاجئة في عدد الأوراق',
    what: 'عدد أوراق الباحث في سنة معيّنة صار 3 أضعاف أو أكثر مقارنة بالسنوات اللي قبلها (مثلاً من 5 أوراق إلى 30).',
    why: 'الإنتاج الحقيقي يزيد بالتدريج. القفزة الحادة قد ترتبط بشراء أوراق من "مصانع الأبحاث" أو الدخول في شبكات تبادل أسماء.',
    normal: 'قد تكون طبيعية إذا حصل الباحث على تمويل كبير، أو أصبح مشرفاً على طلاب دكتوراه كثيرين، أو انضم لفريق بحثي كبير.',
  },
  retracted: {
    title: 'أوراق مسحوبة',
    what: 'أوراق نشرتها المجلة ثم ألغتها رسمياً بعد ما اكتشفت فيها مشكلة. البيانات من قاعدة Retraction Watch.',
    why: 'أقوى مؤشر رسمي، لأن المجلة نفسها اعترفت بوجود مشكلة. الأسباب تشمل التلاعب بالبيانات، أو السرقة العلمية، أو التحكيم المزيّف.',
    normal: 'بعض الأوراق تُسحب بسبب خطأ نزيه يكتشفه الباحث بنفسه، وهذا يُحسب له. اقرأ إشعار السحب لتعرف السبب.',
  },
  tortured: {
    title: 'عبارات معذّبة (Tortured phrases)',
    what: 'مصطلحات علمية معروفة مكتوبة بصياغة غريبة، مثل "counterfeit consciousness" (الوعي المزيّف) بدل "artificial intelligence" (الذكاء الاصطناعي)، أو "bosom malignant growth" بدل "breast cancer".',
    why: 'تظهر عندما يأخذ شخص نصاً منشوراً ويمرّره على أداة إعادة صياغة آلية لإخفاء النقل. أي متخصص حقيقي لا يكتب بهذه الطريقة، فهي من أقوى علامات مصانع الأبحاث.',
    normal: 'نادراً ما تكون بريئة، لكن تأكد بقراءة الجملة في الورقة نفسها.',
  },
  massVenue: {
    title: 'مجلات شهدت سحوبات جماعية',
    what: 'مجلات سحبت آلاف الأوراق دفعة واحدة بعد اكتشاف أن أعداداً كاملة منها كانت مخترقة من مصانع الأبحاث، مثل بعض مجلات دار Hindawi سنة 2023.',
    why: 'النشر المتكرر فيها، خصوصاً في "الأعداد الخاصة"، قد يعني أن الباحث استخدم قنوات نشر سهلة أو مشبوهة.',
    normal: 'هذه المجلات نشرت أيضاً أوراقاً سليمة كثيرة، فورقة أو ورقتان لا تعني شيئاً بحد ذاتها.',
  },
  concentration: {
    title: 'تركّز النشر في مجلة واحدة',
    what: 'أكثر من 30% من أوراق الباحث منشورة في مجلة واحدة.',
    why: 'قد يدل على علاقة خاصة مع رئيس التحرير أو أن الباحث نفسه محرر فيها وينشر لنفسه ولأصحابه.',
    normal: 'في التخصصات الضيقة جداً قد توجد مجلة رئيسية واحدة ينشر فيها الجميع.',
  },
  selfcite: {
    title: 'الاستشهاد الذاتي',
    what: 'نسبة المراجع في أوراق الباحث اللي تشير إلى أوراقه هو. مثلاً 30% تعني أن ثلث المراجع اللي يذكرها هي أبحاثه.',
    why: 'الاستشهادات ترفع "مؤشر h" وترتيب الباحث. الإفراط في الاستشهاد بالنفس يضخّم هذه الأرقام بشكل مصطنع.',
    normal: 'المعدل الطبيعي غالباً أقل من 10–15%. الباحث اللي يبني على شغله السابق في موضوع ضيق قد تكون نسبته أعلى قليلاً.',
  },
  dualAffiliation: {
    title: 'انتماءات مزدوجة في دول مختلفة',
    what: 'الباحث يكتب في نفس الورقة أنه يتبع جامعتين أو أكثر في دول مختلفة. مثلاً جامعة في الهند وجامعة في السعودية في الوقت نفسه.',
    why: 'بعض الجامعات تدفع لباحثين مشهورين من الخارج مقابل إضافة اسمها كانتماء ثانٍ في أبحاثهم، لترتفع في التصنيفات العالمية دون أن يعمل الباحث فيها فعلاً. هذا ما يُسمّى "الانتماء مقابل المال".',
    normal: 'التعاون الدولي الحقيقي شائع: أستاذ زائر، أو إجازة تفرغ علمي، أو مشروع مشترك. الشك يزيد إذا كانت الجامعة الثانية تظهر في عدد كبير من الأوراق دون وجود فعلي للباحث فيها.',
  },
  dispersion: {
    title: 'تشتّت التخصصات',
    what: 'الباحث ينشر في 7 مجالات أو أكثر متباعدة، مثل الطب والهندسة والاقتصاد والكيمياء، دون أن يغلب عليه تخصص واحد.',
    why: 'الباحث الحقيقي عادة متخصص في مجال أو مجالين. التشتّت الكبير قد يعني أن اسمه يُضاف لأوراق خارج تخصصه (تأليف شرفي أو مدفوع).',
    normal: 'المتخصصون في الإحصاء أو الذكاء الاصطناعي يتعاونون طبيعياً مع مجالات كثيرة.',
  },
  yearly: {
    title: 'الإنتاج السنوي',
    what: 'عدد الأوراق المنشورة كل سنة، ويُحسب على الأوراق الفعلية فقط بعد استبعاد المسودات ومجموعات البيانات والنسخ المكررة.',
    why: 'يبيّن لك شكل المسيرة البحثية: نمو تدريجي طبيعي، أو قفزات مفاجئة. الأعمدة الحمراء سنوات تجاوز فيها 72 ورقة.',
    normal: '',
  },
  affiliations: {
    title: 'الانتماءات كما تظهر في الأوراق',
    what: 'كل الجامعات والجهات اللي كتبها الباحث في أوراقه، مع عدد الأوراق والفترة لكل جهة.',
    why: 'انتبه لجامعة تظهر فجأة بعدد كبير من الأوراق في سنوات قليلة، خصوصاً إذا كانت في دولة غير دولة عمل الباحث.',
    normal: 'تغيّر الجامعة مع الانتقال الوظيفي طبيعي، ويظهر كفترات متتالية لا متداخلة.',
  },
  venues: {
    title: 'المجلات',
    what: 'أكثر المجلات اللي نشر فيها الباحث. المجلات المعلّمة "سحوبات جماعية" سبق أن سحبت آلاف الأوراق.',
    why: 'نوعية المجلات تعكس جودة النشر. النشر الكثيف في مجلات سريعة النشر أو مشبوهة يستحق الانتباه.',
    normal: '',
  },
  fields: {
    title: 'المجالات',
    what: 'توزيع أوراق الباحث على المجالات العلمية حسب تصنيف OpenAlex.',
    why: 'يبيّن تخصص الباحث الفعلي، ويكشف إذا كان ينشر في مجالات بعيدة عن تخصصه.',
    normal: '',
  },
  secondaryAff: {
    title: 'انتماء أساسي خارج الجامعة',
    what: 'باحث ينشر أوراقاً باسم الجامعة، لكن جامعته الأساسية الحالية في دولة أخرى.',
    why: 'إذا كان كثير من أكثر الناشرين باسم الجامعة يعملون فعلياً في الخارج، فقد تكون الجامعة تشتري الانتماءات لرفع تصنيفها.',
    normal: 'الأساتذة الزائرون والمتعاونون الحقيقيون موجودون في كل جامعة. الشك يزيد عندما يكون العدد كبيراً والباحثون من الأكثر استشهاداً عالمياً.',
  },
  relation: {
    title: 'علاقة الباحث الخارجي بالجامعة',
    what: 'الباحث من خارج الجامعة يظهر في نتائجها لسببين: إما أنه يكتب اسم الجامعة كانتماء له في أوراقه (منتسب)، أو أن معه في الورقة مؤلفين من الجامعة (تعاون فقط).',
    why: 'الانتماء هو اللي يُحسب للجامعة في التصنيفات العالمية. باحث مشهور يعمل في دولة أخرى ويكتب الجامعة كانتماء في عشرات الأوراق، دون تعاون واضح مع منسوبيها، هو النمط المعروف لـ"شراء الانتماءات".',
    normal: 'التعاون فقط (بدون كتابة الانتماء) طبيعي تماماً. والانتماء يكون طبيعياً إذا كان الباحث أستاذاً زائراً فعلياً أو مشاركاً في مشروع حقيقي مع دكاترة الجامعة.',
  },
  localLink: {
    title: 'الدكتور حلقة الوصل',
    what: 'منسوبو الجامعة اللي يظهرون مع الباحث الخارجي في الأوراق، مرتّبين حسب عدد الأوراق المشتركة، مع منصبهم من ORCID إن وُجد.',
    why: 'إذا كان دكتور واحد من الجامعة موجوداً في أغلب أوراق الباحث الخارجي، فهو غالباً من جلب الباحث للجامعة أو يدير التعاون معه — وهو الشخص المعني بالسؤال.',
    normal: 'المشاريع البحثية المشتركة الحقيقية تنتج أوراقاً كثيرة بين نفس الأشخاص، وهذا طبيعي إذا كان التخصص واحداً والعمل فعلياً.',
  },
  deptMethod: {
    title: 'كيف يُحدَّد القسم؟',
    what: 'قواعد البيانات المفتوحة لا تسجّل القسم اللي يعمل فيه الباحث. لذلك إما نجمع الباحثين حسب تخصص أوراقهم، أو تلصق أنت أسماء أعضاء القسم من موقع الجامعة.',
    why: 'طريقة التخصص سريعة وتكشف كل من ينشر باسم الجامعة في هذا المجال، حتى من خارجها. طريقة الأسماء أدق لأعضاء القسم الفعليين.',
    normal: 'في طريقة التخصص قد يظهر باحثون من أقسام أخرى نشروا في نفس المجال.',
  },
};

function explain(key) {
  const g = GLOSSARY[key];
  if (!g) return '';
  return `<details class="explain no-print"><summary>ايش يعني؟</summary>
    <p><b>المعنى:</b> ${esc(g.what)}</p>
    ${g.why ? `<p><b>ليش مهم:</b> ${esc(g.why)}</p>` : ''}
    ${g.normal ? `<p><b>متى يكون طبيعياً:</b> ${esc(g.normal)}</p>` : ''}
  </details>`;
}

function glossarySection() {
  return `
  <section class="card glossary">
    <details>
      <summary><h3 style="display:inline">📖 دليل المصطلحات: ايش يعني كل مؤشر؟</h3></summary>
      ${Object.values(GLOSSARY).map((g) => `
        <div class="gloss-item">
          <h4>${esc(g.title)}</h4>
          <p><b>المعنى:</b> ${esc(g.what)}</p>
          ${g.why ? `<p><b>ليش مهم:</b> ${esc(g.why)}</p>` : ''}
          ${g.normal ? `<p><b>متى يكون طبيعياً:</b> ${esc(g.normal)}</p>` : ''}
        </div>`).join('')}
    </details>
  </section>`;
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
            <button class="btn small" ${mode === 'department' ? 'data-dept-inst' : 'data-inst'}="${esc(shortId(i.id))}">${mode === 'department' ? 'اختيار' : 'فحص'}</button>
          </li>`).join('')}
      </ul>
    </section>`;
}

/* ---------- تحليل الباحث ---------- */

async function fetchAllWorks(authorId, max, quiet = false) {
  const select = 'id,doi,title,type,publication_year,is_retracted,primary_location,authorships,referenced_works,abstract_inverted_index,primary_topic,cited_by_count';
  const works = [];
  let cursor = '*';
  while (cursor && works.length < max) {
    const page = await oa('/works', { filter: `author.id:${authorId}`, 'per-page': 200, cursor, select, sort: 'publication_year:desc' });
    works.push(...page.results);
    cursor = page.meta.next_cursor;
    if (!quiet) setStatus(`جارٍ جلب الأوراق… ${works.length} من ${num(page.meta.count)}`);
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
  if (dept.rows.length) {
    $('#results').insertAdjacentHTML('afterbegin', '<div class="toolbar no-print"><button class="btn small" data-dept-back="1">→ رجوع لنتائج القسم</button></div>');
  }
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
      key: 'hyperprolific', level: bigCollab ? 'info' : 'high',
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
    flags.push({ key: 'spike', level: 'med', title: 'قفزة مفاجئة في عدد الأوراق', text: `تضاعف الإنتاج 3 مرات أو أكثر خلال سنة: ${spikes.join(' · ')}. القفزات الحادة قد ترتبط بشراء التأليف أو مصانع الأبحاث، أو بتغيير المنصب/الانضمام لفريق كبير.` });
  }

  // 2) أوراق مسحوبة
  const retracted = allWorks.filter((w) => w.is_retracted);
  if (retracted.length) {
    flags.push({ key: 'retracted', level: 'high', title: `أوراق مسحوبة (${retracted.length})`, text: 'أوراق سحبتها المجلات رسمياً (بيانات Retraction Watch/Crossref). راجع إشعار السحب لمعرفة السبب: احتيال، تلاعب بالتحكيم، سرقة، أو خطأ نزيه.' });
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
    flags.push({ key: 'tortured', level: 'high', title: `عبارات معذّبة (Tortured phrases) في ${tortured.length} ورقة`, text: 'صياغات غريبة مثل "counterfeit consciousness" بدل "artificial intelligence" تنتج عن أدوات إعادة الصياغة الآلية لإخفاء النقل، وهي من أقوى مؤشرات مصانع الأبحاث.' });
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
    flags.push({ key: 'massVenue', level: massVenue.length >= 5 ? 'high' : 'med', title: `أوراق في مجلات شهدت سحوبات جماعية (${massVenue.length})`, text: 'مجلات أو سلاسل مؤتمرات سحبت آلاف الأوراق بسبب مصانع الأبحاث والتحكيم المزيّف (مثل أعداد Hindawi الخاصة). ليست دليلاً بذاتها، لكنها تستحق المراجعة.' });
  }
  const topVenues = Object.entries(venueCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (works.length >= 20 && topVenues.length && topVenues[0][1] / works.length > 0.3) {
    flags.push({ key: 'concentration', level: 'med', title: 'تركّز النشر في مجلة واحدة', text: `${pct(topVenues[0][1] / works.length)} من الأوراق في "${topVenues[0][0]}". التركّز الشديد قد يشير إلى علاقة خاصة بهيئة التحرير أو أعداد خاصة.` });
  }

  // 5) الاستشهاد الذاتي (المراجع التي تشير لأوراق الباحث نفسه)
  let totalRefs = 0, selfRefs = 0;
  for (const w of allWorks) {
    for (const r of w.referenced_works || []) { totalRefs++; if (ownIds.has(r)) selfRefs++; }
  }
  const selfRate = totalRefs ? selfRefs / totalRefs : 0;
  if (totalRefs >= 100 && selfRate > 0.15) {
    flags.push({ key: 'selfcite', level: selfRate > 0.25 ? 'high' : 'med', title: `استشهاد ذاتي مرتفع (${pct(selfRate)})`, text: `${num(selfRefs)} من أصل ${num(totalRefs)} مرجعاً في أوراقه تشير إلى أوراقه هو. المعدل المعتاد أقل من ~10–15%. الاستشهاد الذاتي المفرط يضخّم مؤشر h اصطناعياً.` + (truncated ? ' (محسوب على الأوراق المجلوبة فقط، والرقم الحقيقي قد يكون أعلى).' : '') });
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
    flags.push({ key: 'dualAffiliation', level: multiCountryRecent.length >= 10 ? 'high' : 'med', title: `انتماءات مزدوجة في دول مختلفة (${multiCountry} ورقة)`, text: `يذكر الباحث في ${pct(multiCountry / works.length)} من أوراقه انتماءً لمؤسستين أو أكثر في دول مختلفة. هذا النمط قد يكون تعاوناً مشروعاً، لكنه أيضاً علامة معروفة على "الانتماء مقابل المال" لرفع تصنيف الجامعات (خصوصاً بين الباحثين الأكثر استشهاداً).` });
  }

  // 7) تشتّت التخصصات
  const fields = {};
  for (const w of works) { const f = w.primary_topic?.field?.display_name; if (f) fields[f] = (fields[f] || 0) + 1; }
  const fieldList = Object.entries(fields).sort((a, b) => b[1] - a[1]);
  const fieldTotal = fieldList.reduce((s, [, n]) => s + n, 0);
  if (fieldTotal >= 30 && fieldList.length >= 7 && fieldList[0][1] / fieldTotal < 0.4) {
    flags.push({ key: 'dispersion', level: 'med', title: `تشتّت غير معتاد في التخصصات (${fieldList.length} مجالات)`, text: 'النشر في مجالات متباعدة جداً دون تخصص واضح قد يدل على إضافة الاسم كمؤلف شرفي أو شراء مقاعد تأليف.' });
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
      <div><div class="score ${level}"><b>${r.score}</b>${levelText}</div>${explain('score')}</div>
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
    ${explain('position')}
    ${position}
    <p class="muted">المنصب مأخوذ من ORCID (يُدخله الباحث بنفسه). للتأكد راجع صفحة الباحث في موقع الجامعة.</p>
  </section>

  <section class="card">
    <h3>🚩 المؤشرات</h3>
    ${r.flags.length ? r.flags.map((f) => `<div class="flag ${f.level}"><h4>${esc(f.title)} <span class="tag ${f.level}">${{ high: 'مرتفع', med: 'متوسط', info: 'معلومة' }[f.level]}</span></h4><p>${esc(f.text)}</p>${explain(f.key)}</div>`).join('') : '<p>لم تُرصد مؤشرات بارزة في البيانات المتاحة.</p>'}
  </section>

  <section class="card">
    <h3>📈 الإنتاج السنوي</h3>
    ${explain('yearly')}
    <div class="bars">${recentYears.map((y) => `<div class="bar ${r.years[y] > HYPERPROLIFIC ? 'hot' : ''}" style="height:${(r.years[y] / maxYear) * 100}%" title="${y}: ${r.years[y]}"></div>`).join('')}</div>
    <div class="bar-labels">${recentYears.map((y) => `<span title="${y}: ${r.years[y]}">${String(y).slice(2)}</span>`).join('')}</div>
    <p class="muted">الأوراق الفعلية فقط (بدون مسودات أو تكرار). الأعمدة الحمراء: سنوات تجاوز فيها ${HYPERPROLIFIC} ورقة.</p>
  </section>

  ${r.retracted.length ? `<section class="card"><h3>❌ الأوراق المسحوبة</h3>
    ${explain('retracted')}${table(['السنة', 'العنوان', 'روابط'], r.retracted.map((w) => paperRow(w)).join(''))}</section>` : ''}

  ${r.tortured.length ? `<section class="card"><h3>🌀 أوراق بها عبارات معذّبة</h3>
    ${explain('tortured')}${table(['السنة', 'العنوان', 'روابط'], r.tortured.slice(0, 50).map((t) => paperRow(t.work, `<div>${t.phrases.map((p) => `<span class="tag high">"${esc(p)}" ← ${esc(TORTURED_PHRASES[p])}</span>`).join(' ')}</div>`)).join(''))}</section>` : ''}

  ${r.massVenue.length ? `<section class="card"><h3>⚠️ أوراق في مجلات شهدت سحوبات جماعية</h3>
    ${explain('massVenue')}${table(['السنة', 'العنوان', 'روابط'], r.massVenue.slice(0, 50).map((w) => paperRow(w)).join(''))}</section>` : ''}

  <section class="card">
    <h3>🏛️ الانتماءات كما تظهر في الأوراق</h3>
    ${explain('affiliations')}
    ${r.instList.length ? table(['المؤسسة', 'الدولة', 'عدد الأوراق', 'الفترة'], r.instList.slice(0, 15).map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.country || '')}</td><td>${num(i.count)}</td><td>${i.min < 9999 ? `${i.min} – ${i.max}` : ''}</td></tr>`).join('')) : '<p class="muted">لا توجد بيانات.</p>'}
    <p class="muted">انتبه لمؤسسة ثانوية تظهر فجأة بأعداد كبيرة في سنوات قليلة، خصوصاً إن كانت في دولة غير دولة عمل الباحث.</p>
  </section>

  <section class="card">
    <h3>📚 أكثر المجلات نشراً فيها</h3>
    ${explain('venues')}
    ${table(['المجلة', 'عدد الأوراق'], r.topVenues.map(([v, n]) => `<tr><td>${esc(v)}${MASS_RETRACTION_VENUES.includes(v.toLowerCase()) ? ' <span class="tag med">سحوبات جماعية</span>' : ''}</td><td>${n}</td></tr>`).join(''))}
  </section>

  <section class="card">
    <h3>🧭 المجالات</h3>
    ${explain('fields')}
    ${table(['المجال', 'النسبة'], r.fieldList.slice(0, 10).map(([f, n]) => `<tr><td>${esc(f)}</td><td>${pct(n / r.fieldTotal)}</td></tr>`).join(''))}
  </section>`;
}

/* ---------- تحليل المؤسسة ---------- */

async function analyzeInstitution(instId) {
  setStatus('جارٍ تحليل المؤسسة…');
  const inst = await oa('/institutions/' + instId);
  ctxInst = inst;
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
    ${explain('secondaryAff')}
    <p class="muted">إذا كان كثير من أكثر الناشرين باسم الجامعة يعملون أساساً في جامعات بدول أخرى، فهذا نمط "الانتماء الثانوي" الذي يُستخدم لرفع التصنيف.</p>
    ${affRows.length ? table(['الباحث', 'أوراق باسم المؤسسة', 'الانتماء الحالي', 'تقييم', ''], affRows.map((r) => `<tr>
      <td>${esc(r.name)}</td><td>${num(r.count)}</td>
      <td class="muted">${esc(r.lki.map(instLabel).join(' · ') || '—')}</td>
      <td>${r.primaryHere ? '<span class="tag info">أساسي</span>' : r.foreign.length ? '<span class="tag high">ثانوي/أجنبي</span>' : r.listedHere ? '<span class="tag med">مشترك</span>' : '<span class="tag med">غير مدرج حالياً</span>'}</td>
      <td class="btns"><button class="btn small" data-author="${esc(r.id)}">فحص</button>${r.primaryHere ? '' : `<button class="btn small alt" data-relation="${esc(r.id)}">العلاقة بالجامعة</button>`}</td></tr>`).join('')) : '<p class="muted">لم تتوفر بيانات التجميع.</p>'}
  </section>

  <section class="card">
    <h3>⚡ أعلى ذروة إنتاج سنوي بين باحثي المؤسسة (آخر 5 سنوات)</h3>
    ${explain('hyperprolific')}
    <p class="muted">أرقام تقريبية تشمل المسودات ومجموعات البيانات؛ اضغط "فحص" للحصول على العدد الدقيق للأوراق الفعلية.</p>
    ${prolific.length ? table(['الباحث', 'الذروة', 'السنة', 'إجمالي الأوراق', ''], prolific.map(({ a, peak }) => `<tr>
      <td>${esc(a.display_name)}</td>
      <td>${num(peak.works_count)} ${peak.works_count > HYPERPROLIFIC ? '<span class="tag high">مفرط</span>' : ''}</td>
      <td>${esc(peak.year)}</td><td>${num(a.works_count)}</td>
      <td><button class="btn small" data-author="${esc(shortId(a.id))}">فحص</button></td></tr>`).join('')) : '<p class="muted">لا توجد بيانات.</p>'}
  </section>

  <section class="card">
    <h3>❌ أحدث الأوراق المسحوبة المرتبطة بالمؤسسة</h3>
    ${explain('retracted')}
    ${retractedMeta.results.length ? table(['السنة', 'العنوان', 'روابط'], retractedMeta.results.map((w) => paperRow(w)).join('')) : '<p class="muted">لا توجد أوراق مسحوبة مسجّلة.</p>'}
  </section>`;
}

/* ---------- فحص قسم كامل ---------- */

// OpenAlex لا يسجّل الأقسام، لذلك نحدد القسم بطريقتين:
// (أ) التخصص الدقيق (subfield) لأوراق الباحثين المنشورة باسم الجامعة، أو
// (ب) قائمة أسماء أعضاء القسم كما هي في موقع الجامعة.
const dept = { inst: null, label: '', rows: [], running: false };

async function selectDeptInstitution(instId) {
  setStatus('جارٍ جلب تخصصات المؤسسة…');
  const inst = await oa('/institutions/' + instId);
  const since = `${new Date().getFullYear() - 5}-01-01`;
  const subs = await oa('/works', { filter: `institutions.id:${shortId(inst.id)},from_publication_date:${since}`, group_by: 'primary_topic.subfield.id' });
  dept.inst = inst;
  ctxInst = inst;
  setStatus('');
  const options = (subs.group_by || []).filter((g) => g.key && g.key !== 'unknown').slice(0, 80)
    .map((g) => `<option value="${esc(shortId(g.key))}">${esc(g.key_display_name)} (${num(g.count)})</option>`).join('');
  $('#results').innerHTML = `
  <section class="card">
    <h3>🏫 فحص قسم في ${esc(inst.display_name)}</h3>
    ${explain('deptMethod')}
    <p class="muted">قواعد البيانات المفتوحة لا تسجّل الأقسام، فاختر إحدى الطريقتين:</p>

    <h4>الطريقة 1: حسب التخصص</h4>
    <p class="muted">يجلب أكثر الباحثين نشراً باسم الجامعة في هذا التخصص خلال آخر 5 سنوات (الرقم بين القوسين = عدد الأوراق).</p>
    <div class="search">
      <select id="subfield">${options}</select>
      <select id="deptSize"><option value="20">20 باحثاً</option><option value="40" selected>40 باحثاً</option><option value="60">60 باحثاً</option></select>
      <button class="btn" data-dept-subfield="1">عرض الباحثين</button>
    </div>

    <h4>الطريقة 2: قائمة أعضاء القسم (أدق)</h4>
    <p class="muted">انسخ أسماء أعضاء هيئة التدريس من صفحة القسم في موقع الجامعة (بالإنجليزية)، اسم في كل سطر، أو أرقام ORCID.</p>
    <textarea id="deptNames" rows="7" placeholder="Ahmed Ali Alghamdi&#10;Sara Mohammed Alharbi&#10;رقم ORCID مثل 0000-0000-0000-0000"></textarea>
    <div class="toolbar"><button class="btn" data-dept-names="1">مطابقة الأسماء</button></div>
  </section>`;
}

async function loadDeptBySubfield() {
  const sub = $('#subfield');
  const size = Number($('#deptSize').value);
  const instId = shortId(dept.inst.id);
  setStatus('جارٍ جلب باحثي التخصص…');
  const since = `${new Date().getFullYear() - 5}-01-01`;
  const data = await oa('/works', { filter: `institutions.id:${instId},primary_topic.subfield.id:${sub.value},from_publication_date:${since}`, group_by: 'authorships.author.id' });
  const groups = (data.group_by || []).filter((g) => g.key && g.key !== 'unknown').slice(0, size);
  const authors = await fetchAuthorsByIds(groups.map((g) => shortId(g.key)));
  dept.label = sub.options[sub.selectedIndex].text.replace(/\s*\([\d,]+\)$/, '');
  dept.rows = groups.map((g) => makeDeptRow(authors[shortId(g.key)], g.key_display_name, shortId(g.key), g.count)).filter(Boolean);
  setStatus('');
  renderDept();
}

async function loadDeptByNames() {
  const lines = $('#deptNames').value.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 100);
  if (!lines.length) return;
  const instId = shortId(dept.inst.id);
  const rows = [];
  for (const [i, line] of lines.entries()) {
    setStatus(`جارٍ مطابقة الأسماء… ${i + 1} من ${lines.length}`);
    const orcid = line.match(/\d{4}-\d{4}-\d{4}-\d{3}[\dX]/i);
    let a = null;
    try {
      if (orcid) a = await oa('/authors/orcid:' + orcid[0].toUpperCase());
      else {
        // نبحث أولاً بين من لهم انتماء للجامعة لتجنب الخلط بين الأسماء المتشابهة
        const r = await oa('/authors', { search: line, filter: `affiliations.institution.id:${instId}`, 'per-page': 1 });
        a = r.results[0] || null;
      }
    } catch { a = null; }
    rows.push(a ? makeDeptRow(a, a.display_name, shortId(a.id), null, line) : { id: null, name: line, input: line, missing: true, score: null });
  }
  dept.label = 'قائمة أعضاء القسم';
  dept.rows = rows;
  setStatus('');
  renderDept();
}

async function fetchAuthorsByIds(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const r = await oa('/authors', { filter: `id:${chunk.join('|')}`, 'per-page': 50, select: 'id,display_name,last_known_institutions,works_count,orcid' });
    for (const a of r.results) out[shortId(a.id)] = a;
  }
  return out;
}

function makeDeptRow(a, name, id, count, input) {
  const instId = shortId(dept.inst.id);
  const lki = a ? lastInstitutions(a) : [];
  const primaryHere = lki.length > 0 && shortId(lki[0].id) === instId;
  const foreign = lki.filter((i) => shortId(i.id) !== instId && i.country_code && i.country_code !== dept.inst.country_code);
  return { id, name: a?.display_name || name, input, count, lki, primaryHere, foreign, worksCount: a?.works_count, score: null, flags: null };
}

async function scanDept() {
  if (dept.running) return;
  dept.running = true;
  const todo = dept.rows.filter((r) => r.id && r.score === null);
  let done = 0;
  const max = Math.min(Number($('#maxWorks').value), 400);
  const worker = async () => {
    while (todo.length) {
      const row = todo.shift();
      try {
        const author = await oa('/authors/' + row.id);
        const works = await fetchAllWorks(row.id, max, true);
        const rep = buildAuthorReport(author, works);
        row.score = rep.score;
        row.flags = rep.flags.filter((f) => f.level !== 'info').map((f) => ({ level: f.level, title: f.title, key: f.key }));
        row.retracted = rep.retracted.length;
      } catch (err) {
        row.error = err.message;
        if (/حدّ الطلبات/.test(err.message)) { todo.length = 0; setStatus(err.message, true); }
      }
      done++;
      setStatus(`جارٍ فحص أعضاء القسم… ${done} من ${done + todo.length}`);
      renderDept();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  dept.running = false;
  if (!$('#status').classList.contains('error')) setStatus('');
  renderDept();
}

function renderDept() {
  const rows = [...dept.rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const scanned = rows.filter((r) => r.score !== null);
  const flagged = scanned.filter((r) => r.score >= 50).length;
  const foreignCount = rows.filter((r) => !r.primaryHere && r.foreign?.length).length;
  const retractedTotal = scanned.reduce((s, r) => s + (r.retracted || 0), 0);
  const levelOf = (s) => (s >= 50 ? 'high' : s >= 20 ? 'med' : 'low');

  $('#results').innerHTML = `
  ${reportHeader('تقرير فحص قسم', `${dept.label} — ${dept.inst.display_name}`)}
  <section class="card">
    <h2>${esc(dept.label)}</h2>
    <div class="muted">${esc(dept.inst.display_name)} ${esc(dept.inst.country_code || '')}</div>
    <div class="stats">
      <div class="stat"><span>الباحثون</span><b>${num(rows.filter((r) => !r.missing).length)}</b></div>
      <div class="stat"><span>تم فحصهم</span><b>${num(scanned.length)}</b></div>
      <div class="stat"><span>يستحقون التدقيق (50+)</span><b>${num(flagged)}</b></div>
      <div class="stat"><span>أوراق مسحوبة</span><b>${num(retractedTotal)}</b></div>
      <div class="stat"><span>انتماء أساسي خارج الجامعة</span><b>${num(foreignCount)}</b></div>
    </div>
    ${explain('secondaryAff')}${explain('score')}
    <div class="toolbar no-print" style="margin-top:12px">
      ${scanned.length < rows.filter((r) => r.id).length ? `<button class="btn" data-dept-scan="1" ${dept.running ? 'disabled' : ''}>${dept.running ? 'جارٍ الفحص…' : '🔍 فحص الكل'}</button>` : ''}
      <span class="muted">يُحلَّل حتى 400 ورقة لكل باحث. اضغط "تقرير" لتحليل كامل لأي باحث.</span>
    </div>
  </section>

  <section class="card">
    ${table(['الباحث', 'الانتماء الحالي', 'التقييم', 'المؤشرات', ''], rows.map((r) => r.missing ? `<tr><td>${esc(r.input)}</td><td colspan="4" class="muted">لم يُعثر عليه في OpenAlex</td></tr>` : `<tr>
      <td><b>${esc(r.name)}</b>${r.input && r.input.toLowerCase() !== r.name.toLowerCase() ? `<div class="muted">المُدخل: ${esc(r.input)}</div>` : ''}${r.count ? `<div class="muted">${num(r.count)} ورقة في التخصص</div>` : ''}</td>
      <td class="muted">${esc(r.lki.map(instLabel).join(' · ') || '—')} ${r.primaryHere ? '' : r.foreign.length ? '<span class="tag high">خارج الجامعة</span>' : ''}</td>
      <td>${r.score === null ? (r.error ? '<span class="muted">خطأ</span>' : '—') : `<span class="score-pill ${levelOf(r.score)}">${r.score}</span>`}</td>
      <td>${(r.flags || []).map((f) => `<span class="tag ${f.level}" title="${esc(GLOSSARY[f.key]?.what || '')}">${esc(f.title)}</span>`).join(' ') || (r.score === 0 ? '<span class="muted">لا مؤشرات</span>' : '')}</td>
      <td class="btns"><button class="btn small" data-author="${esc(r.id)}">تقرير</button>${r.primaryHere ? '' : `<button class="btn small alt" data-relation="${esc(r.id)}">العلاقة بالجامعة</button>`}</td></tr>`).join(''))}
  </section>`;
}

/* ---------- علاقة باحث خارجي بالجامعة ---------- */

let ctxInst = null;
let backHtml = '';

async function analyzeRelation(authorId) {
  const inst = ctxInst;
  const instId = shortId(inst.id);
  backHtml = $('#results').innerHTML;
  setStatus('جارٍ تحليل علاقة الباحث بالجامعة…');
  const [author, worksPage] = await Promise.all([
    oa('/authors/' + authorId),
    oa('/works', { filter: `author.id:${authorId},institutions.id:${instId}`, 'per-page': 200, select: 'id,doi,title,type,publication_year,primary_location,authorships', sort: 'publication_year:desc' }),
  ]);
  const works = worksPage.results;
  const me = author.id;
  const atInst = (a) => (a.institutions || []).some((i) => shortId(i.id) === instId);

  let selfListed = 0;
  const selfYears = [];
  const locals = {};
  const papers = [];
  for (const w of works) {
    const mine = (w.authorships || []).find((a) => a.author?.id === me);
    const iList = mine && atInst(mine);
    if (iList) { selfListed++; if (w.publication_year) selfYears.push(w.publication_year); }
    const localNames = [];
    const localIds = [];
    for (const a of w.authorships || []) {
      if (!a.author?.id || a.author.id === me || !atInst(a)) continue;
      const k = shortId(a.author.id);
      const l = locals[k] || (locals[k] = { id: k, name: a.author.display_name, count: 0 });
      l.count++;
      localNames.push(a.author.display_name);
      localIds.push(k);
    }
    papers.push({ w, iList, localNames, localIds });
  }
  // نجلب جهة العمل الحالية لكل المؤلفين المرتبطين بالجامعة لنميّز منسوبيها الفعليين
  const allLocals = Object.values(locals).sort((a, b) => b.count - a.count).slice(0, 150);
  const info = allLocals.length ? await fetchAuthorsByIds(allLocals.map((l) => l.id)) : {};
  for (const l of allLocals) {
    const lki = info[l.id] ? lastInstitutions(info[l.id]) : [];
    l.primaryHere = lki.length > 0 && shortId(lki[0].id) === instId;
    l.lki = lki;
  }
  const staffAll = new Set(allLocals.filter((l) => l.primaryHere).map((l) => l.id));
  const localList = [...allLocals].sort((a, b) => (b.primaryHere - a.primaryHere) || (b.count - a.count)).slice(0, 15);

  // المنصب من ORCID لأبرز 6 (منسوبو الجامعة أولاً)
  const norm = (x) => x.toLowerCase().replace(/[^a-z\u0600-\u06ff]+/g, '');
  const target = norm(inst.display_name);
  await Promise.all(localList.slice(0, 6).map(async (l) => {
    const orcid = info[l.id]?.orcid;
    if (!orcid) return;
    const emp = await orcidEmployments(orcid);
    const here = emp?.find((e) => !e.end && (norm(e.org).includes(target) || target.includes(norm(e.org))));
    const cur = here || emp?.find((e) => !e.end);
    if (cur) l.role = [cur.role, cur.dept].filter(Boolean).join(' — ');
  }));
  setStatus('');

  const lki = lastInstitutions(author);
  const primary = lki[0];
  const yrs = selfYears.length ? `${Math.min(...selfYears)} – ${Math.max(...selfYears)}` : '—';
  // منسوبو الجامعة الفعليون (جهة عملهم الأساسية هي الجامعة) مقابل خارجيين آخرين يكتبون الجامعة أيضاً
  const staff = localList.filter((l) => l.primaryHere);
  const withStaff = papers.filter((p) => p.localIds.some((id) => staffAll.has(id))).length;
  const top = staff[0];
  const share = works.length ? (top?.count || 0) / works.length : 0;
  const staffShare = works.length ? withStaff / works.length : 0;

  // الخلاصة بلغة بسيطة
  const lines = [];
  if (selfListed > 0) {
    lines.push(`يكتب <b>${esc(inst.display_name)}</b> كانتماء له في <b>${selfListed}</b> ورقة (${esc(yrs)})، بينما جهة عمله الأساسية الحالية: <b>${esc(primary ? instLabel(primary) : 'غير معروفة')}</b>. هذه الأوراق تُحسب للجامعة في التصنيفات.`);
    if (selfListed >= 10 && staffShare < 0.1) {
      lines.push(`⚠️ <b>${pct(staffShare)} فقط</b> من هذه الأوراق فيها أحد من منسوبي الجامعة الفعليين. أي أن اسم الجامعة يُضاف إلى أوراقه دون تعاون واضح مع دكاترتها — وهذا النمط من أبرز علامات "الانتماء مقابل المال"، ويستحق التحقق من طبيعة عقده مع الجامعة.`);
    } else {
      lines.push(`${pct(staffShare)} من الأوراق فيها أحد من منسوبي الجامعة الفعليين، ما يدل على تعاون بحثي حقيقي بدرجة ما (أستاذ زائر/مشروع مشترك).`);
    }
  } else {
    lines.push(`لا يكتب الجامعة كانتماء له. أوراقه مع الجامعة (${works.length}) سببها أن معه مؤلفين منها — أي <b>تعاون بحثي</b> وليس انتماءً، ولا تُحسب له كمنسوب.`);
  }
  if (top) lines.push(`أكثر دكتور من منسوبي الجامعة ينشر معه: <b>${esc(top.name)}</b>${top.role ? ` (${esc(top.role)})` : ''} في ${top.count} من ${works.length} ورقة (${pct(share)}).${share >= 0.2 ? ' هذا الشخص غالباً هو حلقة الوصل بين الباحث والجامعة.' : ''}`);
  else lines.push('لا يظهر معه أي دكتور جهة عمله الأساسية هي الجامعة.');

  $('#results').innerHTML = `
  <div class="toolbar no-print"><button class="btn small" data-back="1">→ رجوع</button></div>
  ${reportHeader('علاقة باحث بالجامعة', `${author.display_name} — ${inst.display_name}`)}
  <section class="card">
    <h2>${esc(author.display_name)}</h2>
    <div class="muted">جهة العمل الحالية: ${esc(lki.map(instLabel).join(' · ') || 'غير معروفة')}</div>
    <div class="stats">
      <div class="stat"><span>أوراق مرتبطة بالجامعة</span><b>${num(works.length)}</b></div>
      <div class="stat"><span>يكتب الجامعة كانتماء له</span><b>${num(selfListed)}</b></div>
      <div class="stat"><span>فترة الانتماء</span><b>${esc(yrs)}</b></div>
      <div class="stat"><span>أوراق فيها أحد منسوبي الجامعة</span><b>${num(withStaff)} <small>(${pct(staffShare)})</small></b></div>
    </div>
    <div class="flag info" style="margin-top:12px"><h4>الخلاصة</h4>${lines.map((l) => `<p>${l}</p>`).join('')}</div>
    ${explain('relation')}
  </section>

  <section class="card">
    <h3>👥 الدكاترة من الجامعة اللي ينشرون معه</h3>
    ${explain('localLink')}
    ${localList.length ? table(['الدكتور', 'أوراق مشتركة', 'المنصب (ORCID)', 'جهة العمل الحالية', ''], localList.map((l) => `<tr>
      <td><b>${esc(l.name)}</b></td>
      <td>${num(l.count)} <span class="muted">(${pct(l.count / works.length)})</span></td>
      <td>${esc(l.role || '—')}</td>
      <td class="muted">${esc(l.lki.map(instLabel).join(' · ') || '—')} ${l.primaryHere ? '<span class="tag info">من منسوبي الجامعة</span>' : '<span class="tag med">خارجي آخر يكتب الجامعة</span>'}</td>
      <td><button class="btn small" data-author="${esc(l.id)}">تقرير</button></td></tr>`).join('')) : '<p class="muted">لا يوجد أي مؤلف من الجامعة معه في هذه الأوراق.</p>'}
  </section>

  <section class="card">
    <h3>📄 الأوراق المرتبطة بالجامعة</h3>
    ${table(['السنة', 'العنوان', 'روابط'], papers.slice(0, 100).map((p) => paperRow(p.w,
      `<div>${p.iList ? '<span class="tag high">كتب الجامعة كانتماء له</span>' : '<span class="tag info">تعاون فقط</span>'}${p.localNames.length ? ` <span class="muted">مع: ${esc(p.localNames.join('، '))}</span>` : ''}</div>`)).join(''))}
    ${works.length >= 200 ? '<p class="muted">يُعرض أحدث 200 ورقة فقط.</p>' : ''}
  </section>`;
}

/* ---------- تقرير PDF ---------- */

let reportName = '';

let reportFile = 'report';
const REPORT_SLUG = { 'تقرير فحص باحث': 'researcher', 'تقرير فحص مؤسسة': 'institution', 'تقرير فحص قسم': 'department', 'علاقة باحث بالجامعة': 'relation' };

function reportHeader(kind, name) {
  reportName = `${kind} - ${name}`;
  // اسم الملف بالإنجليزية لأن بعض المتصفحات ترفض الأسماء العربية في التحميل
  const ascii = String(name).normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  reportFile = [REPORT_SLUG[kind] || 'report', ascii].filter(Boolean).join('-');
  const date = new Date().toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' });
  return `
  <div class="toolbar no-print">
    <button class="btn" data-pdf="1">📄 تصدير التقرير PDF</button>
    <button class="btn small alt" data-print="1">🖨️ طباعة</button>
  </div>
  <div class="pdf-ready no-print" hidden></div>
  <div class="print-only report-head">
    <h1>${esc(kind)}: ${esc(name)}</h1>
    <p>تاريخ التقرير: ${esc(date)} · المصادر: OpenAlex و ORCID و Retraction Watch</p>
    <p class="note">هذه مؤشرات آلية وإحصائية وليست حكماً أو اتهاماً. يجب التحقق يدوياً من المصادر الأصلية.</p>
  </div>`;
}

function printReport() {
  const prev = document.title;
  document.title = `${reportName} - ${new Date().toISOString().slice(0, 10)}`;
  window.print();
  setTimeout(() => { document.title = prev; }, 1000);
}

function pdfFileName() {
  const day = new Date().toISOString().slice(0, 10);
  return `${reportFile}-${day}.pdf`;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error('تعذّر تحميل مكتبة PDF. تأكد من اتصال الإنترنت.'));
    document.head.appendChild(el);
  });
}

// نبني نسخة نظيفة من التقرير ونقسّمها إلى كتل صغيرة (الجداول كل 18 صفاً)
// حتى لا تتجاوز الصور حدود الذاكرة في الجوال، ثم نضع الكتل في صفحات A4.
// النصوص الإنجليزية داخل سياق عربي تُعزل باتجاه LTR حتى لا تنقلب الأقواس عند الرسم.
function fixBidi(root) {
  const arabic = /[\u0600-\u06FF]/;
  const latin = /[A-Za-z]/;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const t = n.nodeValue;
    if (!latin.test(t)) continue;
    if (!arabic.test(t)) {
      if (!t.trim()) continue;
      const span = document.createElement('span');
      span.dir = 'ltr';
      span.style.unicodeBidi = 'isolate';
      span.style.display = 'inline-block';
      span.textContent = t.trim();
      n.replaceWith(span);
      continue;
    }
    // نص مختلط: نعزل كل مقطع إنجليزي (مع أقواسه) في span
    const frag = document.createDocumentFragment();
    const re = /(\(?[A-Za-z0-9][A-Za-z0-9 .,'’&:()\-\/%–·]*[A-Za-z0-9)%])/g;
    let last = 0, m;
    while ((m = re.exec(t))) {
      frag.appendChild(document.createTextNode(t.slice(last, m.index)));
      const span = document.createElement('span');
      span.dir = 'ltr';
      span.style.unicodeBidi = 'isolate';
      span.textContent = m[1];
      frag.appendChild(span);
      last = m.index + m[1].length;
    }
    frag.appendChild(document.createTextNode(t.slice(last)));
    n.replaceWith(frag);
  }
}

function buildPdfBlocks(host) {
  const blocks = [];
  const add = (nodes, cls = '') => {
    const d = document.createElement('div');
    d.className = 'pdf-block ' + cls;
    nodes.forEach((n) => d.appendChild(n));
    host.appendChild(d);
    blocks.push(d);
  };
  const head = $('#results .report-head');
  if (head) add([head.cloneNode(true)], 'pdf-head');

  const sections = [...document.querySelectorAll('#results > section.card'), ...document.querySelectorAll('#help .glossary')];
  for (const sec of sections) {
    const clone = sec.cloneNode(true);
    clone.querySelectorAll('.no-print, button, .explain, td.links').forEach((n) => n.remove());
    clone.querySelectorAll('th').forEach((th) => { if (th.textContent.trim() === 'روابط' || !th.textContent.trim()) th.remove(); });
    clone.querySelectorAll('td').forEach((td) => { if (!td.textContent.trim() && !td.children.length) td.remove(); });
    clone.querySelectorAll('details').forEach((d) => {
      const div = document.createElement('div');
      [...d.childNodes].forEach((c) => { if (c.nodeName !== 'SUMMARY') div.appendChild(c); else { const h = c.querySelector('h3'); if (h) div.appendChild(h); } });
      d.replaceWith(div);
    });
    // تسطيح المحتوى إلى عناصر متتالية
    const items = [];
    const walk = (el) => {
      for (const c of [...el.children]) {
        if (c.matches('.table-wrap, table')) items.push(c);
        else if (c.matches('div') && c.querySelector('.table-wrap, table, .gloss-item') && !c.matches('.flag')) walk(c);
        else items.push(c);
      }
    };
    fixBidi(clone);
    walk(clone);
    let pending = [];
    const flush = () => { if (pending.length) add(pending); pending = []; };
    for (const it of items) {
      if (it.matches('.table-wrap, table')) {
        const tbl = it.matches('table') ? it : it.querySelector('table');
        const rows = [...tbl.querySelectorAll('tbody > tr')];
        const thead = tbl.querySelector('thead');
        for (let i = 0; i < Math.max(rows.length, 1); i += 3) {
          const t = document.createElement('table');
          if (thead && i % 12 === 0) t.appendChild(thead.cloneNode(true));
          const tb = document.createElement('tbody');
          rows.slice(i, i + 3).forEach((r) => tb.appendChild(r.cloneNode(true)));
          t.appendChild(tb);
          pending.push(t);
          flush();
        }
      } else if (it.matches('h2, h3')) {
        flush();
        pending.push(it); // العنوان يبقى مع ما بعده
      } else {
        pending.push(it);
        if (!pending.some((n) => n.matches && n.matches('h2, h3'))) flush();
        else if (pending.length > 2) flush();
      }
    }
    flush();
    host.appendChild(Object.assign(document.createElement('div'), { className: 'pdf-gap' }));
  }
  return blocks;
}

async function exportPdf(btn) {
  const ready = btn.closest('#results').querySelector('.pdf-ready');
  ready.hidden = true;
  btn.disabled = true;
  const host = document.createElement('div');
  host.className = 'pdf-mode';
  try {
    setStatus('جارٍ تجهيز ملف PDF…');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    document.body.appendChild(host);
    const blocks = buildPdfBlocks(host);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const pageW = 210, pageH = 297, margin = 10, contentW = pageW - margin * 2;
    const mmPerPx = contentW / host.clientWidth;
    let y = margin;
    for (const [i, block] of blocks.entries()) {
      setStatus(`جارٍ تجهيز ملف PDF… ${Math.round(((i + 1) / blocks.length) * 100)}%`);
      const canvas = await window.html2canvas(block, { scale: 2, backgroundColor: '#ffffff', logging: false });
      const h = block.offsetHeight * mmPerPx;
      const gap = block.previousElementSibling?.classList.contains('pdf-gap') ? 4 : 1.5;
      if (y + gap + h > pageH - margin && y > margin) { pdf.addPage(); y = margin; } else if (y > margin) y += gap;
      if (h <= pageH - margin * 2) {
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.78), 'JPEG', margin, y, contentW, h);
        y += h;
      } else {
        // كتلة أطول من صفحة: نقسّمها
        const sliceMm = pageH - margin * 2;
        const pxPerMm = canvas.height / h;
        for (let off = 0; off < h; off += sliceMm) {
          if (off > 0) { pdf.addPage(); y = margin; }
          const part = document.createElement('canvas');
          part.width = canvas.width;
          part.height = Math.min(sliceMm, h - off) * pxPerMm;
          part.getContext('2d').drawImage(canvas, 0, -off * pxPerMm);
          pdf.addImage(part.toDataURL('image/jpeg', 0.78), 'JPEG', margin, y, contentW, part.height / pxPerMm);
          y += part.height / pxPerMm;
        }
      }
    }
    const pages = pdf.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      pdf.setPage(p);
      pdf.setFontSize(8);
      pdf.setTextColor(120);
      pdf.text(`${p} / ${pages}`, pageW / 2, pageH - 4, { align: 'center' });
    }
    const name = pdfFileName();
    const blob = pdf.output('blob');
    const url = URL.createObjectURL(blob);
    const file = new File([blob], name, { type: 'application/pdf' });
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    setStatus('');
    ready.hidden = false;
    ready.innerHTML = `
      <b>✅ التقرير جاهز (${pages} صفحة)</b>
      <div class="toolbar">
        <a class="btn" href="${url}" download="${esc(name)}">📥 تحميل PDF</a>
        ${canShare ? '<button class="btn alt" data-share="1">📤 مشاركة / حفظ في الملفات</button>' : ''}
        <a class="btn small alt" href="${url}" target="_blank" rel="noopener">فتح</a>
      </div>`;
    ready._file = file;
    ready.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    setStatus('تعذّر إنشاء PDF: ' + err.message + ' — جرّب زر الطباعة.', true);
  } finally {
    host.remove();
    btn.disabled = false;
  }
}

async function sharePdf(btn) {
  const file = btn.closest('.pdf-ready')._file;
  try { await navigator.share({ files: [file], title: file.name }); } catch { /* أُلغيت المشاركة */ }
}

/* ---------- الربط ---------- */

// عند الطباعة/PDF نفتح دليل المصطلحات ليظهر في التقرير
window.addEventListener('beforeprint', () => document.querySelectorAll('.glossary details').forEach((d) => { d.dataset.wasOpen = d.open; d.open = true; }));
window.addEventListener('afterprint', () => document.querySelectorAll('.glossary details').forEach((d) => { d.open = d.dataset.wasOpen === 'true'; }));

document.addEventListener('DOMContentLoaded', () => {
  $('#help').innerHTML = glossarySection();
  $('#apiKey').value = storage('oa_key');
  $('#apiKey').addEventListener('change', () => storage('oa_key', $('#apiKey').value.trim()));
  $('#searchForm').addEventListener('submit', onSearch);

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    mode = t.dataset.mode;
    $('#q').placeholder = mode === 'author'
      ? 'اسم الباحث بالإنجليزية، أو رقم ORCID مثل 0000-0002-1825-0097'
      : 'اسم الجامعة بالإنجليزية، مثل King Abdulaziz University';
    if (!dept.running) dept.rows = [];
    $('#results').innerHTML = '';
    setStatus('');
  }));

  $('#results').addEventListener('click', async (e) => {
    const pdfBtn = e.target.closest('button[data-pdf]');
    if (pdfBtn) { exportPdf(pdfBtn); return; }
    if (e.target.closest('button[data-print]')) { printReport(); return; }
    const shareBtn = e.target.closest('button[data-share]');
    if (shareBtn) { sharePdf(shareBtn); return; }
    if (e.target.closest('button[data-dept-back]')) { renderDept(); return; }
    if (e.target.closest('button[data-back]')) { $('#results').innerHTML = backHtml; return; }
    const btn = e.target.closest('button[data-relation], button[data-author], button[data-inst], button[data-dept-inst], button[data-dept-subfield], button[data-dept-names], button[data-dept-scan]');
    if (!btn) return;
    btn.disabled = true;
    try {
      if (btn.dataset.deptScan) { await scanDept(); return; }
      if (btn.dataset.relation) await analyzeRelation(btn.dataset.relation);
      else if (btn.dataset.author) await analyzeAuthor(btn.dataset.author);
      else if (btn.dataset.deptInst) await selectDeptInstitution(btn.dataset.deptInst);
      else if (btn.dataset.deptSubfield) await loadDeptBySubfield();
      else if (btn.dataset.deptNames) await loadDeptByNames();
      else await analyzeInstitution(btn.dataset.inst);
      window.scrollTo({ top: $('#results').offsetTop - 10, behavior: 'smooth' });
    } catch (err) {
      setStatus(err.message, true);
      btn.disabled = false;
    }
  });
});
