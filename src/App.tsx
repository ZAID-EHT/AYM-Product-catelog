import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Expand,
  Grid2X2,
  Home,
  ImageOff,
  LoaderCircle,
  MoreHorizontal,
  Moon,
  RotateCcw,
  Search,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  WifiOff,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { Catalogue, Product, ProductImage, Section } from './types';
import {
  assetUrl,
  createSearchIndex,
  findJumpTarget,
  formatPrice,
  restoreIndex,
  searchProducts,
  swipeDirection,
} from './catalogue';
import {
  persist,
  PROGRESS_KEY,
  readProgress,
  readSaved,
  SAVED_KEY,
  readTheme,
  THEME_KEY,
  type Theme,
} from './persistence';
import { canShareFile, downloadCard, generateProductCard, nativeShare, productUrl } from './share';
import { Modal } from './Modal';
import { useProductSwipe } from './useProductSwipe';

function Photo({
  image,
  name,
  thumbnail = false,
  priority = false,
}: {
  image?: ProductImage;
  name: string;
  thumbnail?: boolean;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const src = image ? assetUrl(thumbnail ? image.thumbnail : image.src) : '';
  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [src]);
  return (
    <div
      className={`photo ${loaded ? 'is-loaded' : ''} ${!image || failed ? 'is-placeholder' : ''}`}
    >
      {image && !failed ? (
        <img
          key={src}
          src={src}
          width={image.width}
          height={image.height}
          alt={name}
          draggable={false}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="placeholder">
          <ImageOff size={thumbnail ? 28 : 44} strokeWidth={1.2} />
          <span>Photograph unavailable</span>
        </div>
      )}
    </div>
  );
}

export function App() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    fetch(assetUrl('catalogue.json'), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('The collection could not be loaded.');
        const data = (await response.json()) as Catalogue;
        if (!Array.isArray(data.products) || !data.products.length || !data.version)
          throw new Error('The collection is empty or needs to be imported again.');
        setCatalogue(data);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, [attempt]);
  if (!catalogue)
    return (
      <div className="startup">
        <div className="brand-word">AYM</div>
        {error ? (
          <>
            <h1>Let’s try that again.</h1>
            <p>{error} Check your connection, then retry.</p>
            <button className="primary" onClick={() => setAttempt((a) => a + 1)}>
              Reload collection
            </button>
          </>
        ) : (
          <>
            <div className="loading-card" />
            <p>
              <LoaderCircle className="spin" size={18} /> Opening the collection
            </p>
          </>
        )}
      </div>
    );
  return <CatalogueApp catalogue={catalogue} />;
}

type Route = { section: Section; detailId: string | null };
function readRoute(): Route {
  const params = new URLSearchParams(location.search);
  const section = params.get('view');
  return {
    section: section === 'search' || section === 'saved' ? section : 'home',
    detailId: params.get('product'),
  };
}

function CatalogueApp({ catalogue }: { catalogue: Catalogue }) {
  const { products } = catalogue;
  const [homeIndex, setHomeIndex] = useState(() => restoreIndex(products, readProgress()));
  const [saved, setSaved] = useState(readSaved);
  const [theme, setTheme] = useState(readTheme);
  const [route, setRoute] = useState(readRoute);
  const [query, setQuery] = useState('');
  const [savedQuery, setSavedQuery] = useState('');
  const [category, setCategory] = useState('');
  const [limit, setLimit] = useState(40);
  const [toast, setToast] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [options, setOptions] = useState(false);
  const [jump, setJump] = useState(false);
  const [jumpValue, setJumpValue] = useState('');
  const [jumpError, setJumpError] = useState('');
  const [shareTarget, setShareTarget] = useState<Product | null>(null);
  const [zoomImage, setZoomImage] = useState<{ photo: number } | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [dragX, setDragX] = useState(0);
  const gesture = useRef<{
    x: number;
    y: number;
    start: number;
    id: number;
    locked: boolean;
  } | null>(null);
  const wasDragged = useRef(false);
  const mainRef = useRef<HTMLElement>(null);
  const index = useMemo(() => createSearchIndex(products), [products]);
  const byId = useMemo(
    () => new Map(products.map((p, i) => [p.id, { product: p, index: i }])),
    [products],
  );
  const savedSet = useMemo(() => new Set(saved), [saved]);
  const savedProducts = useMemo(
    () => products.filter((p) => savedSet.has(p.id)),
    [products, savedSet],
  );
  const results = useMemo(
    () =>
      searchProducts(index, route.section === 'saved' ? savedQuery : query, category).filter(
        (p) => route.section !== 'saved' || savedSet.has(p.id),
      ),
    [index, query, savedQuery, category, route.section, savedSet],
  );
  const detail = route.detailId ? byId.get(route.detailId) : undefined;
  const isHome = route.section === 'home' && !detail;
  const isViewer = isHome || !!detail;
  const product = detail?.product || products[homeIndex];
  const globalIndex = detail?.index ?? homeIndex;
  const collection = route.detailId && route.section !== 'home' ? results : products;
  const collectionIndex = collection.findIndex((p) => p.id === product.id);
  const hasPrevious = (isHome ? homeIndex : collectionIndex) > 0;
  const hasNext =
    (isHome ? homeIndex : collectionIndex) < collection.length - 1 && collectionIndex >= 0;
  const anyModal = options || jump || !!shareTarget || !!zoomImage;

  const navigate = useCallback((next: Route, replace = false) => {
    const url = new URL(location.href);
    url.search = '';
    if (next.section !== 'home') url.searchParams.set('view', next.section);
    if (next.detailId) url.searchParams.set('product', next.detailId);
    history[replace ? 'replaceState' : 'pushState']({}, '', url);
    setRoute(next);
  }, []);
  useEffect(() => {
    const pop = () => setRoute(readRoute());
    const connection = () => setOnline(navigator.onLine);
    const sync = (event: StorageEvent) => {
      if (event.key === SAVED_KEY) setSaved(readSaved());
      if (event.key === PROGRESS_KEY) setHomeIndex(restoreIndex(products, readProgress()));
      if (event.key === THEME_KEY || event.key === null) setTheme(readTheme());
    };
    window.addEventListener('popstate', pop);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
      window.removeEventListener('storage', sync);
    };
  }, [products]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#151b18' : '#ffffff');
  }, [theme]);
  function changeTheme(next: Theme) {
    setTheme(next);
    if (!persist(THEME_KEY, next)) setStorageError(true);
  }
  useEffect(() => {
    if (
      !persist(PROGRESS_KEY, {
        id: products[homeIndex].id,
        index: homeIndex,
        version: catalogue.version,
      })
    )
      setStorageError(true);
  }, [homeIndex, products, catalogue.version]);
  // Each navigation writes synchronously as well as on effect; no dependence on unload.
  function updateHome(next: number) {
    const safe = Math.max(0, Math.min(next, products.length - 1));
    if (!persist(PROGRESS_KEY, { id: products[safe].id, index: safe, version: catalogue.version }))
      setStorageError(true);
    setHomeIndex(safe);
  }
  useEffect(() => {
    if (toast) {
      const timer = window.setTimeout(() => setToast(''), 3800);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    setLimit(40);
  }, [query, savedQuery, category, route.section]);
  useEffect(() => {
    setPhotoIndex(0);
    setDragX(0);
  }, [product.id]);
  useEffect(() => {
    if (isViewer) {
      const neighbors = [collection[collectionIndex - 1], collection[collectionIndex + 1]];
      const images = neighbors
        .flatMap((p) => p?.images.slice(0, 1) || [])
        .map((img) => {
          const image = new Image();
          image.src = assetUrl(img.src);
          return image;
        });
      return () => {
        images.forEach((img) => {
          img.onload = null;
          img.onerror = null;
        });
      };
    }
  }, [product.id, isViewer, collection, collectionIndex]);
  useEffect(() => {
    if (
      !import.meta.env.PROD ||
      !('serviceWorker' in navigator) ||
      !isViewer ||
      !product.images[photoIndex]
    )
      return;
    let live = true;
    navigator.serviceWorker.ready
      .then((registration) => {
        if (live)
          registration.active?.postMessage({
            type: 'CACHE_VIEWED',
            urls: [new URL(assetUrl(product.images[photoIndex].src), location.href).href],
          });
      })
      .catch(() => {
        /* Basic browsing remains available without caching. */
      });
    return () => {
      live = false;
    };
  }, [product.id, photoIndex, isViewer]);
  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
    mainRef.current?.scrollTo({ top: 0 });
  }, [route.section, route.detailId]);

  function toggleSave(p: Product) {
    const removing = savedSet.has(p.id);
    const next = removing ? saved.filter((id) => id !== p.id) : [...new Set([...saved, p.id])];
    setSaved(next);
    if (!persist(SAVED_KEY, next)) setStorageError(true);
    setToast(removing ? 'Removed from Saved' : 'Added to your Saved collection');
    navigator.vibrate?.(8);
  }
  const move = useCallback(
    (step: number) => {
      if (!isViewer || (step < 0 && !hasPrevious) || (step > 0 && !hasNext)) return;
      setDirection(step);
      if (isHome) updateHome(homeIndex + step);
      else navigate({ ...route, detailId: collection[collectionIndex + step].id }, true);
      navigator.vibrate?.(5);
    },
    [
      isViewer,
      hasPrevious,
      hasNext,
      isHome,
      homeIndex,
      route,
      collection,
      collectionIndex,
      navigate,
    ],
  );
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if (
        anyModal ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        (e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')
      )
        return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        move(1);
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        move(-1);
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [move, anyModal]);
  function pointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'touch') return;
    if (!e.isPrimary) {
      gesture.current = null;
      setDragX(0);
      wasDragged.current = true;
      return;
    }
    if (
      !e.isPrimary ||
      e.button !== 0 ||
      e.clientX < 24 ||
      e.clientX > innerWidth - 24 ||
      (e.target as HTMLElement).closest('button:not(.photo-open)')
    )
      return;
    wasDragged.current = false;
    gesture.current = {
      x: e.clientX,
      y: e.clientY,
      start: performance.now(),
      id: e.pointerId,
      locked: false,
    };
  }
  function pointerMove(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'touch') return;
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x,
      dy = e.clientY - g.y;
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) wasDragged.current = true;
    if (!g.locked && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
      gesture.current = null;
      return;
    }
    if (!g.locked && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      g.locked = true;
      wasDragged.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (g.locked) setDragX(dx * ((dx < 0 && !hasNext) || (dx > 0 && !hasPrevious) ? 0.15 : 0.65));
  }
  function pointerEnd(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'touch') return;
    const g = gesture.current;
    gesture.current = null;
    setDragX(0);
    if (g && g.id === e.pointerId && g.locked) {
      const step = swipeDirection(e.clientX - g.x, e.clientY - g.y, performance.now() - g.start);
      if (step) move(step);
    }
  }
  const productSwipeRef = useProductSwipe<HTMLElement>({
    enabled: isViewer && !anyModal,
    onSwipe: move,
    onStart: () => {
      wasDragged.current = false;
    },
    onMove: () => {
      wasDragged.current = true;
    },
    onDrag: (dx) => setDragX(dx * ((dx < 0 && !hasNext) || (dx > 0 && !hasPrevious) ? 0.15 : 0.65)),
  });
  function showSection(section: Section) {
    navigate({ section, detailId: null });
    setCategory('');
  }
  function openProduct(p: Product) {
    navigate({ section: route.section, detailId: p.id });
  }
  function jumpToProduct(e: React.FormEvent) {
    e.preventDefault();
    const target = findJumpTarget(products, jumpValue);
    if (!target) {
      setJumpError(
        'No unique product found. Try its workbook number, or use Search to choose by code.',
      );
      return;
    }
    setJump(false);
    setJumpValue('');
    setJumpError('');
    navigate({ section: 'home', detailId: target.id });
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to collection
      </a>
      <header className="topbar">
        <button className="brand" onClick={() => showSection('home')} aria-label="AYM Home">
          <span className="brand-word">AYM</span>
          <span className="brand-divider" />
          <span className="brand-description">Everyday, well considered.</span>
        </button>
        <div className="topbar-right">
          <span className="local-status">
            {online ? <span className="status-dot" /> : <WifiOff size={14} />}
            {storageError ? 'Session only' : 'Your place, remembered'}
          </span>
          <button
            className="icon-button menu-button"
            aria-label="Catalogue options"
            onClick={() => setOptions(true)}
          >
            <MoreHorizontal size={24} />
          </button>
        </div>
      </header>
      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className={isViewer ? 'viewer-page' : 'collection-page'}
      >
        {storageError && (
          <div className="notice" role="alert">
            Your browser blocked storage. Browsing and Saved work for this session, but can’t be
            restored after closing. Enable site storage to keep them.
          </div>
        )}
        {!online && (
          <div className="notice offline">
            <WifiOff size={16} /> You’re offline. Previously opened photos remain available.
          </div>
        )}
        {route.detailId && !detail && (
          <div className="notice" role="status">
            This product is no longer in the catalogue. Your browsing place is still here.
            <button onClick={() => showSection('home')}>Continue browsing</button>
          </div>
        )}
        {isViewer ? (
          <>
            <div className="page-heading">
              {detail ? (
                <button
                  className="back-button"
                  onClick={() => navigate({ section: route.section, detailId: null })}
                >
                  <ChevronLeft size={20} />
                  {route.section === 'search'
                    ? 'Search results'
                    : route.section === 'saved'
                      ? 'Your Saved'
                      : 'Back to collection'}
                </button>
              ) : (
                <div>
                  <div className="eyebrow desktop-eyebrow">A WORLD OF EVERYDAY FINDS</div>
                  <h1>
                    The collection<span className="green-period">.</span>
                  </h1>
                  <p>{products.length.toLocaleString()} products. One discovery at a time.</p>
                </div>
              )}
              <button
                className="collection-count"
                onClick={() => {
                  setJumpValue('');
                  setJump(true);
                }}
                aria-label="Jump to a product"
              >
                <Grid2X2 size={15} />
                <span>{products.length.toLocaleString()} products</span>
                <ChevronRight size={14} />
              </button>
            </div>
            <section ref={productSwipeRef} className="product-stage" aria-label="Product viewer">
              <div className="photograph-column">
                <div
                  className={`photograph-frame ${dragX ? 'is-dragging' : ''}`}
                  onPointerDown={pointerDown}
                  onPointerMove={pointerMove}
                  onPointerUp={pointerEnd}
                  onPointerCancel={() => {
                    gesture.current = null;
                    setDragX(0);
                  }}
                  style={
                    {
                      '--drag': `${dragX}px`,
                      '--turn': `${dragX / 40}deg`,
                      '--direction': direction,
                    } as CSSProperties
                  }
                  data-testid="swipe-area"
                >
                  <button
                    className="photo-open"
                    aria-label={`Enlarge photograph of ${product.name}`}
                    onClick={() => {
                      if (!wasDragged.current && product.images.length)
                        setZoomImage({ photo: photoIndex });
                    }}
                    aria-disabled={!product.images.length}
                  >
                    <div key={`${product.id}-${photoIndex}`} className="photo-transition">
                      <Photo image={product.images[photoIndex]} name={product.name} priority />
                    </div>
                  </button>
                  <span className="photo-label">AYM COLLECTION</span>
                  {product.images.length > 0 && (
                    <button
                      className="expand-button icon-button"
                      aria-label="Expand product image"
                      onClick={() => setZoomImage({ photo: photoIndex })}
                    >
                      <Expand size={19} />
                    </button>
                  )}
                  {product.images.length > 1 && (
                    <div className="gallery-controls">
                      <button
                        className="icon-button"
                        aria-label="Previous photo"
                        disabled={photoIndex === 0}
                        onClick={() => setPhotoIndex((i) => i - 1)}
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <span>
                        {photoIndex + 1} / {product.images.length} photos
                      </span>
                      <button
                        className="icon-button"
                        aria-label="Next photo"
                        disabled={photoIndex === product.images.length - 1}
                        onClick={() => setPhotoIndex((i) => i + 1)}
                      >
                        <ChevronRight size={18} />
                      </button>
                    </div>
                  )}
                </div>
                <div className="swipe-hint">
                  <span className="hint-line" />
                  <span>
                    Swipe left for next <span className="hint-arrows">↔</span> right for previous
                  </span>
                  <span className="hint-line" />
                </div>
              </div>
              <div className="product-details" key={product.id}>
                <div className="product-kicker">
                  <span>{product.category || 'AYM COLLECTION'}</span>
                  <span className="product-no">Nº {String(product.number).padStart(4, '0')}</span>
                </div>
                <h2 data-testid="product-name">{product.name || 'Unnamed product'}</h2>
                {product.sku && (
                  <p className="product-code">
                    Product code <span>{product.sku}</span>
                  </p>
                )}
                {product.description && (
                  <p className="product-description">{product.description}</p>
                )}
                <div className="price-actions">
                  <div className="price-block">
                    <p className="price" data-testid="product-price">
                      {formatPrice(product.price, catalogue.currency, catalogue.precision)}
                    </p>
                    <span className="price-label">{product.priceLabel}</span>
                  </div>
                  <div className="product-actions">
                    <button
                      className={`action-button ${savedSet.has(product.id) ? 'is-saved' : ''}`}
                      aria-label={savedSet.has(product.id) ? 'Remove from Saved' : 'Save product'}
                      aria-pressed={savedSet.has(product.id)}
                      onClick={() => toggleSave(product)}
                    >
                      <Bookmark
                        size={21}
                        fill={savedSet.has(product.id) ? 'currentColor' : 'none'}
                      />
                      <span>{savedSet.has(product.id) ? 'Saved' : 'Save'}</span>
                    </button>
                    <button
                      className="action-button"
                      aria-label="Share product"
                      onClick={() => setShareTarget(product)}
                    >
                      <Share2 size={21} />
                      <span>Share</span>
                    </button>
                  </div>
                </div>
                {product.priceSource === 'Old Price (LKR)' && (
                  <p className="price-caveat">
                    Current price not supplied. Showing the workbook’s last listed price.
                  </p>
                )}
                {product.priceSource === 'Price 2 (LKR)' && (
                  <p className="price-caveat">
                    Showing Price 2 from the workbook; the main Price field is empty.
                  </p>
                )}
                {product.prices['Price (LKR)'] !== null &&
                  product.prices['Price 2 (LKR)'] !== null &&
                  product.prices['Price (LKR)'] !== product.prices['Price 2 (LKR)'] && (
                    <p className="alternate-price">
                      Price 2{' '}
                      <span>
                        {formatPrice(
                          product.prices['Price 2 (LKR)'],
                          catalogue.currency,
                          catalogue.precision,
                        )}
                      </span>
                    </p>
                  )}
                <div className="browse-controls">
                  <button
                    className="nav-arrow"
                    aria-label="Previous product"
                    disabled={!hasPrevious}
                    onClick={() => move(-1)}
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <button
                    className="position"
                    aria-label="Jump to product number or code"
                    onClick={() => {
                      setJumpValue('');
                      setJump(true);
                    }}
                  >
                    <span className="position-count" data-testid="position">
                      {globalIndex + 1} <span>/ {products.length.toLocaleString()}</span>
                    </span>
                    <span className="position-label">
                      {isHome ? 'YOUR PLACE IN THE COLLECTION' : 'EXPLORING · HOME PLACE KEPT'}
                    </span>
                  </button>
                  <button
                    className="nav-arrow next-arrow"
                    aria-label="Next product"
                    disabled={!hasNext}
                    onClick={() => move(1)}
                  >
                    <ArrowRight size={20} />
                  </button>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label="Catalogue position"
                  aria-valuenow={globalIndex + 1}
                  aria-valuemin={1}
                  aria-valuemax={products.length}
                >
                  <span style={{ width: `${((globalIndex + 1) / products.length) * 100}%` }} />
                </div>
                <div className="progress-footnote">
                  <ShieldCheck size={14} />
                  <span>
                    {isHome
                      ? 'Your place is automatically saved on this device.'
                      : `Home is waiting at product ${homeIndex + 1}.`}
                  </span>
                </div>
              </div>
            </section>
            <div className="desktop-bottom-note">
              <span>GOOD FINDS. AT YOUR OWN PACE.</span>
              <span>Browse · Save · Share</span>
            </div>
          </>
        ) : (
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  {route.section === 'saved' ? 'COLLECT WHAT YOU LOVE' : 'FIND YOUR NEXT DISCOVERY'}
                </div>
                <h1>
                  {route.section === 'saved' ? 'Your Saved' : 'Search'}
                  <span className="green-period">.</span>
                </h1>
                <p>
                  {route.section === 'saved'
                    ? `${savedProducts.length} ${savedProducts.length === 1 ? 'product' : 'products'}, kept close.`
                    : 'A name, a code, a little inspiration.'}
                </p>
              </div>
              <span className="section-symbol">
                {route.section === 'saved' ? <Bookmark size={28} /> : <Search size={28} />}
              </span>
            </div>
            <div className="search-tools">
              <div className="search-field">
                <Search size={20} />
                <label className="sr-only" htmlFor="catalogue-search">
                  {route.section === 'saved' ? 'Search saved products' : 'Search products'}
                </label>
                <input
                  id="catalogue-search"
                  type="search"
                  autoComplete="off"
                  placeholder={
                    route.section === 'saved'
                      ? 'Search your Saved'
                      : 'Search by name or product code'
                  }
                  value={route.section === 'saved' ? savedQuery : query}
                  onChange={(e) =>
                    route.section === 'saved'
                      ? setSavedQuery(e.target.value)
                      : setQuery(e.target.value)
                  }
                />
                {(route.section === 'saved' ? savedQuery : query) && (
                  <button
                    className="icon-button"
                    aria-label="Clear search"
                    onClick={() => (route.section === 'saved' ? setSavedQuery('') : setQuery(''))}
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
              {!!catalogue.categories.length && (
                <label className="category-filter">
                  <SlidersHorizontal size={18} />
                  <select
                    aria-label="Filter by category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="">All categories</option>
                    {catalogue.categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="results-heading">
              <span role="status">
                {results.length.toLocaleString()} {results.length === 1 ? 'product' : 'products'}
                {(route.section === 'saved' ? savedQuery : query) ? ' found' : ''}
              </span>
              <span>Home place: {homeIndex + 1}</span>
            </div>
            {results.length ? (
              <>
                <div className="results-grid">
                  {results.slice(0, limit).map((p) => (
                    <article key={p.id} className="result-card">
                      <button
                        className="result-open"
                        aria-label={`Open ${p.name}`}
                        onClick={() => openProduct(p)}
                      >
                        <Photo image={p.images[0]} name={p.name} thumbnail />
                        <div className="result-content">
                          <span className="result-code">{p.sku || `Nº ${p.number}`}</span>
                          <h2>{p.name || 'Unnamed product'}</h2>
                          <p>{formatPrice(p.price, catalogue.currency, catalogue.precision)}</p>
                          <span className="result-price-label">{p.priceLabel}</span>
                        </div>
                      </button>
                      <div className="result-actions">
                        <button
                          className={`icon-button ${savedSet.has(p.id) ? 'is-saved' : ''}`}
                          aria-label={`${savedSet.has(p.id) ? 'Remove' : 'Save'} ${p.name}${savedSet.has(p.id) ? ' from Saved' : ''}`}
                          aria-pressed={savedSet.has(p.id)}
                          onClick={() => toggleSave(p)}
                        >
                          <Bookmark size={19} fill={savedSet.has(p.id) ? 'currentColor' : 'none'} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Share ${p.name}`}
                          onClick={() => setShareTarget(p)}
                        >
                          <Share2 size={19} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                {results.length > limit && (
                  <button className="load-more secondary" onClick={() => setLimit((n) => n + 40)}>
                    Show 40 more <ChevronRight size={18} />
                  </button>
                )}
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">
                  {route.section === 'saved' ? (
                    <Bookmark size={34} strokeWidth={1.3} />
                  ) : (
                    <Search size={34} strokeWidth={1.3} />
                  )}
                </div>
                <h2>
                  {route.section === 'saved' && !savedQuery
                    ? 'Your next favourite is out there.'
                    : 'Nothing here just yet.'}
                </h2>
                <p>
                  {route.section === 'saved' && !savedQuery
                    ? 'Tap the bookmark on any product to keep it here. Your collection stays on this device.'
                    : 'Try another name or product code. A shorter search can help.'}
                </p>
                <button
                  className="primary"
                  onClick={() =>
                    route.section === 'saved' && !savedQuery
                      ? showSection('home')
                      : route.section === 'saved'
                        ? setSavedQuery('')
                        : setQuery('')
                  }
                >
                  {route.section === 'saved' && !savedQuery
                    ? 'Explore the collection'
                    : 'Clear search'}
                  <ArrowRight size={18} />
                </button>
              </div>
            )}
          </>
        )}
      </main>
      <div className="bottom-nav-wrap">
        <nav className="bottom-nav" aria-label="Main navigation">
          {(
            [
              { section: 'home', Icon: Home, label: 'Home' },
              { section: 'search', Icon: Search, label: 'Search' },
              { section: 'saved', Icon: Bookmark, label: 'Saved' },
            ] as const
          ).map(({ section, Icon, label }) => (
            <button
              key={section}
              className={route.section === section ? 'active' : ''}
              aria-current={route.section === section ? 'page' : undefined}
              onClick={() => showSection(section)}
            >
              <Icon size={21} strokeWidth={route.section === section ? 2 : 1.7} />
              <span>{label}</span>
              {section === 'saved' && savedProducts.length > 0 && (
                <span className="saved-badge">
                  {savedProducts.length > 99 ? '99+' : savedProducts.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>
      <div className={`toast ${toast ? 'visible' : ''}`} role="status" aria-live="polite">
        {toast && (
          <>
            <Check size={17} />
            {toast}
          </>
        )}
      </div>
      {options && (
        <Modal title="Make yourself at home" close={() => setOptions(false)}>
          <p className="sheet-intro">
            Your browsing place and Saved collection are kept on this device.
          </p>
          <fieldset className="theme-picker">
            <legend>Appearance</legend>
            {(['light', 'dark'] as const).map((choice) => (
              <label key={choice} className={theme === choice ? 'selected' : ''}>
                <input
                  type="radio"
                  name="theme"
                  value={choice}
                  checked={theme === choice}
                  onChange={() => changeTheme(choice)}
                />
                {choice === 'light' ? <Sun size={20} /> : <Moon size={20} />}
                <span>{choice === 'light' ? 'Light (default)' : 'Dark'}</span>
              </label>
            ))}
          </fieldset>
          <button
            className="option-row"
            onClick={() => {
              setOptions(false);
              showSection('home');
            }}
          >
            <Bookmark size={21} />
            <span>
              <strong>Continue browsing</strong>
              <small>
                Product {homeIndex + 1} of {products.length.toLocaleString()}
              </small>
            </span>
            <ChevronRight size={20} />
          </button>
          <button
            className="option-row"
            onClick={() => {
              setOptions(false);
              setJumpValue('');
              setJump(true);
            }}
          >
            <Grid2X2 size={21} />
            <span>
              <strong>Jump to a product</strong>
              <small>Explore without moving your Home place</small>
            </span>
            <ChevronRight size={20} />
          </button>
          <button
            className="option-row"
            onClick={() => {
              setOptions(false);
              updateHome(0);
              showSection('home');
              setToast('Browsing restarted at product 1');
            }}
          >
            <RotateCcw size={21} />
            <span>
              <strong>Start from beginning</strong>
              <small>Reset browsing position. Keep your Saved.</small>
            </span>
            <ChevronRight size={20} />
          </button>
          <div className="device-note">
            <Sparkles size={20} />
            <div>
              <strong>Keep AYM one tap away.</strong>
              <p>On iPhone, open Safari’s Share menu and choose Add to Home Screen.</p>
            </div>
          </div>
          <p className="privacy-note">
            No account needed. Clearing this browser’s site data removes your progress and Saved.
            Prices are reproduced from the source workbook; fallback prices are labelled.
          </p>
        </Modal>
      )}
      {jump && (
        <Modal title="A shortcut to your next find" close={() => setJump(false)}>
          <p className="sheet-intro">
            Enter a product number (1–{products.length.toLocaleString()}) or its full code. Your
            Home place stays at {homeIndex + 1}.
          </p>
          <p className="sheet-intro">
            For a numeric SKU, use a prefix such as <strong>sku:600</strong>. Plain numbers open
            workbook product numbers.
          </p>
          <form onSubmit={jumpToProduct}>
            <label className="field-label" htmlFor="jump-input">
              Product number or code
            </label>
            <input
              className="jump-input"
              id="jump-input"
              value={jumpValue}
              onChange={(e) => {
                setJumpValue(e.target.value);
                setJumpError('');
              }}
              placeholder="e.g. 101 or 2638-HA"
              autoComplete="off"
              autoFocus
            />
            {jumpError && (
              <p className="field-error" role="alert">
                {jumpError}
              </p>
            )}
            <button className="primary full-width" type="submit">
              Open product
              <ArrowRight size={18} />
            </button>
          </form>
        </Modal>
      )}
      {shareTarget && (
        <ShareSheet product={shareTarget} close={() => setShareTarget(null)} notify={setToast} />
      )}
      {zoomImage && (
        <ZoomSheet
          product={product}
          initial={zoomImage.photo}
          hasPrevious={hasPrevious}
          hasNext={hasNext}
          move={move}
          saved={savedSet.has(product.id)}
          save={() => toggleSave(product)}
          share={() => setShareTarget(product)}
          active={!shareTarget}
          position={`${(isHome ? homeIndex : collectionIndex) + 1} / ${collection.length.toLocaleString()}`}
          close={() => setZoomImage(null)}
        />
      )}
    </div>
  );
}

function ShareSheet({
  product,
  close,
  notify,
}: {
  product: Product;
  close: () => void;
  notify: (message: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  const [copyFallback, setCopyFallback] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true,
      url = '';
    setError('');
    setFile(null);
    setPreview('');
    generateProductCard(product)
      .then((result) => {
        if (live) {
          setFile(result);
          url = URL.createObjectURL(result);
          setPreview(url);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [product, attempt]);
  async function share() {
    if (!file) return;
    setSharing(true);
    setError('');
    try {
      if (!(await nativeShare(file, product))) {
        downloadCard(file);
        notify('Product image downloaded');
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError')
        setError('Sharing was unavailable. You can still download the image below.');
    } finally {
      setSharing(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(productUrl(product));
      notify('Product link copied');
    } catch {
      setCopyFallback(true);
    }
  }
  return (
    <Modal title="A good find, worth sharing." close={close}>
      <p className="sheet-intro">A beautifully simple product card, ready to send.</p>
      {error && (
        <p className="field-error" role="alert">
          {error}
          {!file && (
            <button className="text-button" onClick={() => setAttempt((a) => a + 1)}>
              Try again
            </button>
          )}
        </p>
      )}
      <div className="share-preview">
        {preview ? (
          <img src={preview} alt={`Product photograph and full name: ${product.name}`} />
        ) : (
          !error && (
            <div className="share-loading">
              <LoaderCircle className="spin" size={28} />
              <span>Preparing your high-resolution PNG…</span>
            </div>
          )
        )}
      </div>
      <button className="primary full-width" disabled={!file || sharing} onClick={share}>
        {sharing ? (
          <LoaderCircle className="spin" size={19} />
        ) : file && canShareFile(file) ? (
          <Share2 size={19} />
        ) : (
          <ArrowDownToLine size={19} />
        )}
        {file && canShareFile(file) ? 'Share image' : 'Download image'}
      </button>
      {file && canShareFile(file) && (
        <button
          className="secondary full-width"
          onClick={() => {
            downloadCard(file);
            notify('Product image downloaded');
          }}
        >
          <ArrowDownToLine size={18} />
          Download image
        </button>
      )}
      <button className="secondary full-width" onClick={copy}>
        <Copy size={18} />
        Copy product link
      </button>
      {copyFallback && (
        <div>
          <label className="field-label" htmlFor="product-link">
            Copy this product link
          </label>
          <input
            className="jump-input"
            id="product-link"
            readOnly
            value={productUrl(product)}
            onFocus={(e) => e.target.select()}
            autoFocus
          />
        </div>
      )}
      <p className="privacy-note">PNG image · 1080 px wide · Product photo and name only</p>
    </Modal>
  );
}

function ZoomSheet({
  product,
  initial,
  close,
  hasPrevious,
  hasNext,
  move,
  position,
  saved,
  save,
  share,
  active,
}: {
  product: Product;
  initial: number;
  close: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  move: (step: number) => void;
  position: string;
  saved: boolean;
  save: () => void;
  share: () => void;
  active: boolean;
}) {
  const [photo, setPhoto] = useState(initial);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const swipe = useRef<{ x: number; y: number; start: number } | null>(null);
  const lastProduct = useRef(product.id);
  const swipeRef = useProductSwipe<HTMLDivElement>({
    enabled: active && scale === 1,
    onSwipe: move,
  });
  useEffect(() => {
    if (lastProduct.current === product.id) return;
    lastProduct.current = product.id;
    setPhoto(0);
    setScale(1);
    setOffset({ x: 0, y: 0 });
    pointers.current.clear();
    pinch.current = null;
    swipe.current = null;
  }, [product.id]);
  useEffect(() => {
    if (!active) return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        move(event.key === 'ArrowRight' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [move, active]);
  function end(e: PointerEvent) {
    const start = swipe.current;
    swipe.current = null;
    if (
      e.pointerType !== 'touch' &&
      e.type === 'pointerup' &&
      start &&
      scale === 1 &&
      pointers.current.size === 1
    ) {
      const step = swipeDirection(
        e.clientX - start.x,
        e.clientY - start.y,
        performance.now() - start.start,
      );
      if (step) move(step);
    }
    pointers.current.delete(e.pointerId);
    pinch.current = null;
  }
  return (
    <Modal title="A closer look" close={close} wide fullscreen>
      <div ref={swipeRef} className="zoom-content">
        <div className="zoom-product-heading">
          <h3
            className="zoom-product-name"
            data-testid="fullscreen-product-name"
            aria-live="polite"
          >
            {product.name}
          </h3>
          <div className="product-actions">
            <button
              className={`action-button ${saved ? 'is-saved' : ''}`}
              aria-label={saved ? 'Remove from Saved' : 'Save product'}
              aria-pressed={saved}
              onClick={save}
            >
              <Bookmark size={20} fill={saved ? 'currentColor' : 'none'} />
              <span>{saved ? 'Saved' : 'Save'}</span>
            </button>
            <button className="action-button" aria-label="Share product" onClick={share}>
              <Share2 size={20} />
              <span>Share</span>
            </button>
          </div>
        </div>
        <div className="zoom-toolbar">
          <button
            className="icon-button soft"
            aria-label="Zoom out"
            disabled={scale <= 1}
            onClick={() => {
              setScale((s) => Math.max(1, s - 0.5));
              setOffset({ x: 0, y: 0 });
            }}
          >
            <ZoomOut size={20} />
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button
            className="icon-button soft"
            aria-label="Zoom in"
            disabled={scale >= 4}
            onClick={() => setScale((s) => Math.min(4, s + 0.5))}
          >
            <ZoomIn size={20} />
          </button>
          <button
            className="text-button"
            onClick={() => {
              setScale(1);
              setOffset({ x: 0, y: 0 });
            }}
          >
            Reset
          </button>
        </div>
        <div
          className="zoom-viewport"
          onPointerDown={(e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            swipe.current =
              pointers.current.size === 1 && scale === 1
                ? { x: e.clientX, y: e.clientY, start: performance.now() }
                : null;
            if (pointers.current.size > 1) pinch.current = null;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const old = pointers.current.get(e.pointerId);
            if (!old) return;
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const touches = [...pointers.current.values()];
            if (touches.length === 2) {
              const distance = Math.hypot(touches[0].x - touches[1].x, touches[0].y - touches[1].y);
              if (!pinch.current) pinch.current = { distance, scale };
              else
                setScale(
                  Math.max(
                    1,
                    Math.min(4, (pinch.current.scale * distance) / pinch.current.distance),
                  ),
                );
            } else if (scale > 1)
              setOffset((o) => ({
                x: Math.max(-1000, Math.min(1000, o.x + e.clientX - old.x)),
                y: Math.max(-1000, Math.min(1000, o.y + e.clientY - old.y)),
              }));
          }}
          onPointerUp={end}
          onPointerCancel={end}
          onDoubleClick={() => {
            setScale((s) => (s === 1 ? 2 : 1));
            setOffset({ x: 0, y: 0 });
          }}
        >
          <div
            className="zoom-image"
            style={{
              transform: `translate(${scale === 1 ? 0 : offset.x}px, ${scale === 1 ? 0 : offset.y}px) scale(${scale})`,
            }}
          >
            <Photo image={product.images[photo]} name={product.name} priority />
          </div>
        </div>
        {product.images.length > 1 && (
          <div className="zoom-footer">
            <button
              className="icon-button soft"
              aria-label="Previous zoom photo"
              disabled={photo === 0}
              onClick={() => {
                setPhoto((p) => p - 1);
                setScale(1);
                setOffset({ x: 0, y: 0 });
              }}
            >
              <ChevronLeft size={20} />
            </button>
            <span>
              {photo + 1} / {product.images.length} · Pinch or use + to zoom
            </span>
            <button
              className="icon-button soft"
              aria-label="Next zoom photo"
              disabled={photo === product.images.length - 1}
              onClick={() => {
                setPhoto((p) => p + 1);
                setScale(1);
                setOffset({ x: 0, y: 0 });
              }}
            >
              <ChevronRight size={20} />
            </button>
          </div>
        )}
        <div className="zoom-product-controls">
          <button
            className="icon-button soft"
            aria-label="Previous fullscreen product"
            disabled={!hasPrevious}
            onClick={() => move(-1)}
          >
            <ChevronLeft size={24} />
          </button>
          <div>
            <span aria-live="polite">{position}</span>
            <p>Swipe left for next · right for previous</p>
          </div>
          <button
            className="icon-button soft"
            aria-label="Next fullscreen product"
            disabled={!hasNext}
            onClick={() => move(1)}
          >
            <ChevronRight size={24} />
          </button>
        </div>
      </div>
    </Modal>
  );
}
