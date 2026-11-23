const { readFile, mkdir, rename, rm, writeFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { JSDOM } = require('jsdom');

const SHOPEE = 'https://shopee.vn';
const PRODUCT_LINKS = 'a[href*="-i."], a[href*="/product/"]';
const KEYWORDS = [
  'bao đựng thẻ sinh viên', 'bao đựng thẻ cute',
  'bao đựng thẻ nhân viên', 'bao đựng thẻ dây rút',
  'combo bao thẻ 50 cái', 'bao thẻ hội nghị',
];
const RESEARCH_KEYWORDS = [...KEYWORDS,
  'bao đựng thẻ ID', 'bao thẻ nhựa dẻo', 'bao thẻ nhựa cứng', 'bao thẻ bảng tên',
  'vỏ thẻ nhân viên', 'bao đựng thẻ học sinh', 'bao thẻ đeo cổ', 'bao đựng thẻ xe buýt',
  'bao thẻ ngang', 'bao thẻ dọc', 'bao thẻ dây rút yoyo', 'bao thẻ sự kiện',
  'combo bao đựng thẻ', 'bao thẻ mica',
];
const COLUMNS = [
  'shop_id', 'item_id', 'product_url', 'title', 'price_min_vnd', 'price_max_vnd',
  'sold_display', 'rating', 'reviews_display', 'keywords', 'sources', 'read_at',
  'sold_qty', 'sold_qty_kind',
];
const NUMBER = '(?:[0-9]{1,3}(?:[., ][0-9]{3})+|[0-9]+)';
const SEPARATOR = '\\s*[-–—]\\s*';
const PRICE = new RegExp([
  `(?:₫\\s*(${NUMBER})\\s*(?:₫)?${SEPARATOR}₫?\\s*(${NUMBER})\\s*₫?)`,
  `(?:(${NUMBER})\\s*₫?${SEPARATOR}(${NUMBER})\\s*₫)`,
  `(?:₫\\s*(${NUMBER})|(${NUMBER})\\s*₫)`,
].join('|'), 'u');
const COUNT = `(?<![0-9.,])(?:[0-9]+(?:[.,][0-9]+)?\\s*(?:k|m|nghìn|triệu)|${NUMBER})(?:\\s*\\+)?(?![0-9.,+])`;
const REVIEW_LABEL = '(?:lượt\\s+)?đánh\\s+giá';
const SOLD_AFTER_LABEL = new RegExp(`đã\\s+bán\\s*(${COUNT})(?!\\s*${REVIEW_LABEL})`, 'iu');
const SOLD_BEFORE_LABEL = new RegExp(`(${COUNT})\\s*đã\\s+bán`, 'iu');
const REVIEWS = new RegExp(`(${COUNT})\\s*${REVIEW_LABEL}`, 'iu');
const OUTSIDE_SCOPE = /^(?:\[[^\]]+\]\s*)*(?:ốp(?:\s+lưng|\s+điện thoại)|ví(?:\s+da)?\s+đựng thẻ|(?:hộp|bao|vỏ)\s+(?:đựng\s+)?thẻ nhớ|(?:bao|hộp)\s+đựng\s+photocard)(?=\s|$)/iu;
const ID_CARD_TITLE = /(?:(?:bao|vỏ|bọc|hộp|túi|giá đỡ)\s+(?:(?:đựng|bọc|bảo vệ)\s+)?thẻ|thẻ\s+đeo|(?:bao|đeo)\s+bảng tên|\bid card holder\b|dây đeo thẻ.{0,60}(?:kèm|tặng)\s+bao)/iu;

const clean = (value) => value?.replace(/\s+/gu, ' ').trim() || '';

function parseSold(value) {
  const sold_display = clean(value);
  const lowerBound = sold_display.endsWith('+');
  const amount = sold_display.replace(/\s*\+$/u, '').toLowerCase();
  const abbreviated = amount.match(/^([0-9]+(?:[.,][0-9]+)?)\s*(k|m|nghìn|triệu)$/u);
  const integer = /^(?:[0-9]+|[0-9]{1,3}(?:[., ][0-9]{3})+)$/u.test(amount);
  const sold_qty = abbreviated
    ? Math.round(Number(abbreviated[1].replace(',', '.')) * (['k', 'nghìn'].includes(abbreviated[2]) ? 1_000 : 1_000_000))
    : integer ? Number(amount.replace(/[., ]/gu, '')) : NaN;
  if (!Number.isSafeInteger(sold_qty)) return { sold_display, sold_qty: '', sold_qty_kind: '' };
  const sold_qty_kind = lowerBound ? 'lower_bound' : abbreviated ? 'approximate' : 'exact';
  return { sold_display, sold_qty, sold_qty_kind };
}

function productIds(href) {
  let url;
  try {
    url = new URL(href, SHOPEE);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(url.hostname)) return null;
  return url.pathname.match(/(?:-i\.([0-9]+)\.([0-9]+)|^\/product\/([0-9]+)\/([0-9]+))\/?$/u)?.slice(1).filter(Boolean);
}

function cardText(anchor) {
  const document = anchor.ownerDocument;
  const walker = document.createTreeWalker(anchor, 4);
  const parts = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement.closest('script, style, noscript, [hidden], [aria-hidden="true"]')) continue;
    const value = clean(node.nodeValue);
    if (value) parts.push(value);
  }
  return parts;
}

function parseCard(anchor, [shopId, itemId]) {
  const parts = cardText(anchor);
  const text = parts.join(' ');
  const name = anchor.querySelector('[data-sqe="name"], [itemprop="name"], [class*="line-clamp-2"], h2, h3');
  const title = [anchor.getAttribute('title'), name?.textContent, anchor.querySelector('img[alt]')?.alt]
    .map(clean)
    .find((value) => value.length >= 5 && !/^(?:shopee|product image|ảnh sản phẩm)$/iu.test(value))
    || clean(text.slice(0, text.match(PRICE)?.index ?? text.length));
  if (!title) return null;

  const start = text.indexOf(title);
  const details = start < 0 ? text : text.slice(start + title.length);
  const price = details.match(PRICE);
  const amounts = price?.slice(1).filter(Boolean).map((value) => Number(value.replace(/[., ]/gu, ''))) || [];
  const afterPrice = price ? details.slice(price.index + price[0].length) : details;
  const sold = afterPrice.match(SOLD_AFTER_LABEL) || afterPrice.match(SOLD_BEFORE_LABEL);
  const saleSuffix = sold ? afterPrice.slice(sold.index + sold[0].length) : '';
  const periodSales = /^\s*(?:\/\s*(?:tháng|ngày|tuần)|trong\s+(?:[0-9]+\s+)?(?:tháng|ngày|tuần)|tháng\s+qua)/iu.test(saleSuffix);
  const reviews = afterPrice.match(REVIEWS);
  const ratingLabel = anchor.querySelector('[itemprop="ratingValue"], [aria-label*="sao" i]');
  const ratingText = clean(ratingLabel?.getAttribute('content') || ratingLabel?.getAttribute('aria-label') || ratingLabel?.textContent);
  const rating = ratingText.match(/^[0-5](?:[.,][0-9])?(?=\s|\/|$)/u)?.[0]
    || afterPrice.match(/(?:^|\s)([0-5][.,][0-9]|[0-5](?=\s*\/\s*5))(?=\s|\/|$)/u)?.[1];

  return {
    shop_id: shopId,
    item_id: itemId,
    product_url: `${SHOPEE}/product/${shopId}/${itemId}`,
    title,
    price_min_vnd: amounts.length ? Math.min(...amounts) : '',
    price_max_vnd: amounts.length ? Math.max(...amounts) : '',
    ...parseSold(periodSales ? '' : sold?.[1]),
    rating: rating && Number(rating.replace(',', '.')) <= 5 ? rating.replace(',', '.') : '',
    reviews_display: clean(reviews?.[1]),
  };
}

function addProduct(row, source, keyword, options, products, readAt) {
  if (!row || row.price_min_vnd === '' || (options['require-sold'] && row.sold_qty === '')) return false;
  if (!options['all-products'] && (OUTSIDE_SCOPE.test(row.title) || (options.strict && !ID_CARD_TITLE.test(row.title)))) return false;
  const id = `${row.shop_id}/${row.item_id}`;
  const product = products.get(id) || { ...row, keywords: new Set(), sources: new Set(), read_at: readAt };
  if (product.sold_qty === '' && row.sold_qty !== '') {
    product.sold_display = row.sold_display;
    product.sold_qty = row.sold_qty;
    product.sold_qty_kind = row.sold_qty_kind;
  }
  for (const key of ['rating', 'reviews_display']) {
    if (!product[key]) product[key] = row[key];
  }
  if (keyword) product.keywords.add(keyword);
  product.sources.add(source);
  products.set(id, product);
  return true;
}

function readProducts(html, source, keyword, options, products) {
  const dom = new JSDOM(html);
  try {
    const { document } = dom.window;
    const pageProducts = new Set();
    const anchors = [...document.querySelectorAll(PRODUCT_LINKS)]
      .map((anchor) => [anchor, productIds(anchor.getAttribute('href'))]).filter(([, ids]) => ids);
    const cardIds = [...new Set(anchors.map(([, ids]) => ids.join('/')))];
    const readAt = new Date().toISOString();
    for (const [anchor, ids] of anchors) {
      const id = ids.join('/');
      if (pageProducts.has(id)) continue;
      const row = parseCard(anchor, ids);
      if (!addProduct(row, source, keyword, options, products, readAt)) continue;
      pageProducts.add(id);
      if (pageProducts.size === options.limit || products.size >= options.target) break;
    }
    console.error(`${keyword || source} — ${pageProducts.size} sản phẩm phù hợp.`);
    return cardIds.join(',');
  } finally {
    dom.window.close();
  }
}

function csvCell(value) {
  let cell = String(value ?? '');
  if (/^\s*[=+@-]/u.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/u.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

async function saveCsv(products, output) {
  const rows = [COLUMNS.join(',')];
  for (const product of products.values()) {
    rows.push(COLUMNS.map((key) => csvCell(product[key] instanceof Set ? [...product[key]].join(' | ') : product[key])).join(','));
  }
  await mkdir(path.dirname(output), { recursive: true });
  const temp = `${output}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `\uFEFF${rows.join('\r\n')}\r\n`, { flag: 'wx' });
    await rename(temp, output);
  } finally {
    await rm(temp, { force: true });
  }
}

async function crawl(keywords, options, products) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ locale: 'vi-VN' });
    for (const keyword of keywords) {
      const seenPages = new Set();
      for (let index = 0; index < options.pages; index++) {
        const url = new URL('/search', SHOPEE);
        url.searchParams.set('keyword', keyword);
        if (index > 0) url.searchParams.set('page', String(index));
        const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 25_000 });
        const current = new URL(page.url());
        if (!response?.ok() || current.origin !== SHOPEE || current.pathname !== '/search') {
          throw new Error(`Shopee không trả về trang tìm kiếm cho “${keyword}” (HTTP ${response?.status() ?? '?'}).`);
        }
        const cards = page.locator(PRODUCT_LINKS).first();
        const empty = page.getByText(/^(?:không tìm thấy kết quả|không có kết quả)/iu).first();
        await cards.or(empty).first().waitFor({ state: 'attached', timeout: 15_000 }).catch((error) => {
          if (error.name !== 'TimeoutError') throw error;
          throw new Error(`Không đọc được kết quả cho “${keyword}”. Trang có thể đang yêu cầu đăng nhập hoặc xác minh, hoặc đã đổi bố cục.`);
        });
        if (!await cards.count() && await empty.count()) break;
        const pageIds = readProducts(await page.content(), current.href, keyword, options, products);
        if (products.size >= options.target) return;
        if (!pageIds || seenPages.has(pageIds)) break;
        seenPages.add(pageIds);
      }
    }
  } finally {
    await browser.close();
  }
}

function positiveInteger(value, fallback, flag) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`--${flag} phải là số nguyên dương.`);
  return number;
}

async function main() {
  const { values, positionals: [mode, ...inputs] } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      limit: { type: 'string' },
      pages: { type: 'string' },
      target: { type: 'string' },
      keyword: { type: 'string' },
      'all-products': { type: 'boolean' },
      'require-sold': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || !mode) {
    console.log('Đọc HTML: node shopee_reader/read.cjs html <tệp.html> [...] [--keyword "từ khóa"]\n'
      + 'Tìm trực tiếp: node shopee_reader/read.cjs crawl ["từ khóa" ...]\n'
      + 'Tùy chọn chung: -o <tệp.csv>, --target <số sản phẩm duy nhất>, --limit <số sản phẩm mỗi trang>, --require-sold, --all-products\n'
      + 'Tùy chọn crawl: --pages <số trang tối đa mỗi từ khóa>');
    return;
  }
  const target = positiveInteger(values.target, Infinity, 'target');
  const output = values.output || (target === Infinity ? 'data/shopee-id-cards.csv' : `data/shopee-id-cards-${target}.csv`);
  const options = {
    ...values, target,
    strict: mode === 'crawl' && target !== Infinity,
    limit: positiveInteger(values.limit, 20, 'limit'),
    pages: positiveInteger(values.pages, 1, 'pages'),
  };
  const products = new Map();
  if (mode === 'html') {
    if (!inputs.length) throw new Error('Hãy truyền ít nhất một tệp HTML.');
    if (inputs.some((file) => path.resolve(file) === path.resolve(output))) {
      throw new Error('Hãy chọn tệp CSV đầu ra khác với tệp HTML đầu vào.');
    }
    for (const file of inputs) {
      const html = await readFile(file, 'utf8');
      if (!readProducts(html, file, values.keyword, options, products)) {
        console.error(`Không tìm thấy thẻ sản phẩm Shopee trong ${file}.`);
      }
      if (products.size >= options.target) break;
    }
  } else if (mode === 'crawl') {
    if (values.keyword !== undefined) throw new Error(`Với ${mode}, truyền các từ khóa sau tên lệnh.`);
    const keywords = inputs.length ? [...new Set(inputs.map(clean).filter(Boolean))] : options.strict ? RESEARCH_KEYWORDS : KEYWORDS;
    if (!keywords.length) throw new Error('Cần ít nhất một từ khóa khác rỗng.');
    try {
      await crawl(keywords, options, products);
    } catch (error) {
      if (!products.size) throw error;
      console.error(`Dừng thu thập: ${error.message} Lưu phần dữ liệu đã đọc.`);
      process.exitCode = 1;
    }
  } else {
    throw new Error('Chọn lệnh html hoặc crawl. Dùng --help để xem cú pháp.');
  }
  if (!products.size) throw new Error('Không có sản phẩm phù hợp để xuất CSV.');
  await saveCsv(products, output);
  const withSold = [...products.values()].filter((row) => row.sold_qty !== '').length;
  console.log(`Đã lưu ${products.size} sản phẩm, ${withSold} có số đã bán, vào ${output}`);
  if (target !== Infinity && products.size < target) {
    console.error(`Nguồn đã đọc trả ${products.size}/${target} sản phẩm phù hợp.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
