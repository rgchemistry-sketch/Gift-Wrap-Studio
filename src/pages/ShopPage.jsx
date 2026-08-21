import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Container from 'react-bootstrap/Container';
import Form from 'react-bootstrap/Form';
import Offcanvas from 'react-bootstrap/Offcanvas';
import Row from 'react-bootstrap/Row';
import Icon from '../components/Icon';
import ProductCard from '../components/ProductCard';
import StorefrontSelect from '../components/StorefrontSelect';
import { ProductCardSkeleton } from '../components/Feedback';
import { useCatalog } from '../data/useCatalog';
import { formatPieceCount, getCatalogEmptyCopy, getShopHeroCopy } from '../utils/shop-presentation';
import '../home-shop-redesign.css';

const priceOptions = [
  ['', 'All prices'],
  ['under-1500', 'Under ₹1,500'],
  ['1500-2500', '₹1,500 – ₹2,500'],
  ['over-2500', 'Over ₹2,500'],
];

const sortOptions = [
  { value: 'featured', label: 'Featured' },
  { value: 'price-low', label: 'Price: low to high' },
  { value: 'price-high', label: 'Price: high to low' },
  { value: 'name', label: 'Name' },
];

const heroArtwork = {
  collection: {
    className: 'shop-hero--collection',
    srcSet: [640, 960, 1280, 1600, 1983]
      .map((width) => `/assets/shop-collection-hero-${width}.webp ${width}w`)
      .join(', '),
  },
  personalized: {
    className: 'shop-hero--personalized',
    srcSet: [640, 960, 1280, 1600, 1983]
      .map((width) => `/assets/shop-personalized-hero-${width}.webp ${width}w`)
      .join(', '),
  },
  wedding: {
    className: 'shop-hero--wedding',
    srcSet: [640, 960, 1280, 1600, 1983]
      .map((width) => `/assets/shop-wedding-hero-${width}.webp ${width}w`)
      .join(', '),
  },
};

const transparentPixel = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

function getHeroArtwork(filters) {
  if (filters.occasion.toLowerCase() === 'wedding') return heroArtwork.wedding;
  if (filters.category.toLowerCase() === 'personalized gifts') return heroArtwork.personalized;
  return heroArtwork.collection;
}

function FilterPanel({ filters, setFilter, products, idPrefix }) {
  const productCategories = [...new Set(products.map((product) => product.category).filter(Boolean))].sort();
  const productOccasions = [...new Set(products.map((product) => product.occasion).filter(Boolean))].sort();

  return (
    <div className="filter-panel">
      <div className="filter-group">
        <h3>Collection</h3>
        <Form.Check
          type="radio"
          name={`${idPrefix}-category`}
          id={`${idPrefix}-category-all`}
          label="All collections"
          checked={!filters.category}
          onChange={() => setFilter('category', '')}
        />
        {productCategories.map((category) => (
          <Form.Check
            type="radio"
            name={`${idPrefix}-category`}
            id={`${idPrefix}-category-${category.replace(/\W/g, '')}`}
            key={category}
            label={category}
            checked={filters.category === category}
            onChange={() => setFilter('category', category)}
          />
        ))}
      </div>
      <div className="filter-group">
        <h3>Occasion</h3>
        <Form.Check
          type="radio"
          name={`${idPrefix}-occasion`}
          id={`${idPrefix}-occasion-all`}
          label="All occasions"
          checked={!filters.occasion}
          onChange={() => setFilter('occasion', '')}
        />
        {productOccasions.map((occasion) => (
          <Form.Check
            type="radio"
            name={`${idPrefix}-occasion`}
            id={`${idPrefix}-occasion-${occasion.replace(/\W/g, '')}`}
            key={occasion}
            label={occasion}
            checked={filters.occasion === occasion}
            onChange={() => setFilter('occasion', occasion)}
          />
        ))}
      </div>
      <div className="filter-group">
        <h3>Price</h3>
        {priceOptions.map(([value, label]) => (
          <Form.Check
            type="radio"
            name={`${idPrefix}-price`}
            id={`${idPrefix}-price-${value || 'all'}`}
            key={value}
            label={label}
            checked={filters.price === value}
            onChange={() => setFilter('price', value)}
          />
        ))}
      </div>
      <div className="filter-group filter-group--toggle">
        <Form.Check
          type="switch"
          id={`${idPrefix}-customizable-only`}
          label="Customizable pieces only"
          checked={filters.customizable === 'true'}
          onChange={(event) => setFilter('customizable', event.target.checked ? 'true' : '')}
        />
        <Form.Check
          type="switch"
          id={`${idPrefix}-available-only`}
          label="Available now"
          checked={filters.available === 'true'}
          onChange={(event) => setFilter('available', event.target.checked ? 'true' : '')}
        />
      </div>
    </div>
  );
}

export default function ShopPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { products, loading, error, truncated, refresh } = useCatalog();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const catalogSectionRef = useRef(null);
  const pendingCatalogPositionRef = useRef(null);
  const filterTriggerRef = useRef(null);
  const filterDoneRef = useRef(null);
  const filterScrollPositionRef = useRef(null);
  const stableScrollPositionRef = useRef(0);
  const scrollSettleTimerRef = useRef(null);
  const filtersOpenRef = useRef(false);

  const filters = {
    q: searchParams.get('q') || '',
    category: searchParams.get('category') || '',
    occasion: searchParams.get('occasion') || '',
    price: searchParams.get('price') || '',
    customizable: searchParams.get('customizable') || '',
    available: searchParams.get('available') || '',
    sort: searchParams.get('sort') || 'featured',
  };

  const loadProducts = () => refresh({ force: true });

  useEffect(() => {
    stableScrollPositionRef.current = window.scrollY;
    const rememberSettledPosition = () => {
      if (scrollSettleTimerRef.current) window.clearTimeout(scrollSettleTimerRef.current);
      if (filtersOpenRef.current) return;
      scrollSettleTimerRef.current = window.setTimeout(() => {
        if (filtersOpenRef.current) return;
        stableScrollPositionRef.current = window.scrollY;
        scrollSettleTimerRef.current = null;
      }, 120);
    };
    const rememberKeyboardScroll = (event) => {
      if (['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' '].includes(event.key)) {
        rememberSettledPosition();
      }
    };

    // Scroll-into-view calls made by focus-management libraries are not a user
    // navigation intent. Only pointer, wheel, touch and keyboard gestures update
    // this anchor, so opening the drawer cannot teach it the accidental position.
    window.addEventListener('wheel', rememberSettledPosition, { passive: true });
    window.addEventListener('touchend', rememberSettledPosition, { passive: true });
    window.addEventListener('pointerup', rememberSettledPosition, { passive: true });
    window.addEventListener('keyup', rememberKeyboardScroll);
    return () => {
      window.removeEventListener('wheel', rememberSettledPosition);
      window.removeEventListener('touchend', rememberSettledPosition);
      window.removeEventListener('pointerup', rememberSettledPosition);
      window.removeEventListener('keyup', rememberKeyboardScroll);
      if (scrollSettleTimerRef.current) window.clearTimeout(scrollSettleTimerRef.current);
    };
  }, []);

  const restoreFilterScrollPosition = () => {
    const storedPosition = filterScrollPositionRef.current;
    if (storedPosition == null) return;
    window.scrollTo({ top: storedPosition, left: 0, behavior: 'instant' });
  };

  const openFilters = () => {
    if (scrollSettleTimerRef.current) {
      window.clearTimeout(scrollSettleTimerRef.current);
      scrollSettleTimerRef.current = null;
    }
    // Capture the viewport at the exact activation boundary. Gesture-settled
    // tracking can legitimately lag behind programmatic, scrollbar, or
    // assistive-technology scrolling and must not decide where the page returns.
    const currentScrollPosition = window.scrollY;
    filterScrollPositionRef.current = currentScrollPosition;
    stableScrollPositionRef.current = currentScrollPosition;
    filtersOpenRef.current = true;
    setFiltersOpen(true);
  };

  const closeFilters = () => setFiltersOpen(false);

  const finishOpeningFilters = () => {
    restoreFilterScrollPosition();
    filterDoneRef.current?.focus({ preventScroll: true });
    window.requestAnimationFrame(() => {
      restoreFilterScrollPosition();
      filterDoneRef.current?.focus({ preventScroll: true });
      window.requestAnimationFrame(restoreFilterScrollPosition);
    });
    window.setTimeout(restoreFilterScrollPosition, 80);
  };

  const finishClosingFilters = () => {
    restoreFilterScrollPosition();
    window.requestAnimationFrame(() => {
      restoreFilterScrollPosition();
      filterTriggerRef.current?.focus({ preventScroll: true });
      window.requestAnimationFrame(() => {
        restoreFilterScrollPosition();
        filterTriggerRef.current?.focus({ preventScroll: true });
      });
    });
    window.setTimeout(() => {
      restoreFilterScrollPosition();
      stableScrollPositionRef.current = filterScrollPositionRef.current ?? window.scrollY;
      filterScrollPositionRef.current = null;
      filtersOpenRef.current = false;
    }, 80);
  };

  const preserveCatalogPosition = () => {
    const catalogSection = catalogSectionRef.current;
    if (!catalogSection) return;
    pendingCatalogPositionRef.current = catalogSection.getBoundingClientRect().top;
  };

  const setFilter = (key, value) => {
    preserveCatalogPosition();
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true, preventScrollReset: true });
  };

  const clearFilters = () => {
    preserveCatalogPosition();
    const next = new URLSearchParams();
    if (filters.sort !== 'featured') next.set('sort', filters.sort);
    setSearchParams(next, { replace: true, preventScrollReset: true });
  };

  const filterStateKey = searchParams.toString();
  useLayoutEffect(() => {
    const previousTop = pendingCatalogPositionRef.current;
    const catalogSection = catalogSectionRef.current;
    if (previousTop == null || !catalogSection) return;

    const nextTop = catalogSection.getBoundingClientRect().top;
    const delta = nextTop - previousTop;
    if (Math.abs(delta) > 1) window.scrollBy({ top: delta, left: 0, behavior: 'instant' });
    pendingCatalogPositionRef.current = null;
  }, [filterStateKey]);

  const filteredProducts = useMemo(() => {
    const query = filters.q.trim().toLowerCase();
    const result = products.filter((product) => {
      if (query && !`${product.title} ${product.category} ${product.occasion} ${product.description}`.toLowerCase().includes(query)) return false;
      if (filters.category && product.category !== filters.category) return false;
      if (filters.occasion && product.occasion !== filters.occasion) return false;
      if (filters.customizable === 'true' && !product.customizable) return false;
      if (filters.available === 'true' && !product.inStock) return false;
      if (filters.price === 'under-1500' && product.price >= 1500) return false;
      if (filters.price === '1500-2500' && (product.price < 1500 || product.price > 2500)) return false;
      if (filters.price === 'over-2500' && product.price <= 2500) return false;
      return true;
    });

    return [...result].sort((a, b) => {
      if (filters.sort === 'price-low') return a.price - b.price;
      if (filters.sort === 'price-high') return b.price - a.price;
      if (filters.sort === 'name') return a.title.localeCompare(b.title);
      return Number(b.featured) - Number(a.featured)
        || Number(b.inStock) - Number(a.inStock);
    });
  }, [products, filters.q, filters.category, filters.occasion, filters.customizable, filters.available, filters.price, filters.sort]);

  const filterChipLabels = {
    q: (value) => `“${value}”`,
    customizable: () => 'Customizable only',
    available: () => 'Available now',
    price: (value) => priceOptions.find(([option]) => option === value)?.[1] || value,
  };
  const activeFilters = Object.entries(filters)
    .filter(([key, value]) => value && key !== 'sort')
    .map(([key, value]) => [key, filterChipLabels[key]?.(value) ?? value]);

  const heroCopy = getShopHeroCopy(filters);
  const artwork = getHeroArtwork(filters);
  const emptyCopy = getCatalogEmptyCopy(activeFilters.length > 0);

  return (
    <>
      <section className={`page-hero shop-hero ${artwork.className}`}>
        <picture className="shop-hero__media" aria-hidden="true">
          <source media="(max-width: 767.98px)" srcSet={artwork.srcSet} sizes="100vw" />
          <source media="(min-width: 768px)" srcSet={artwork.srcSet} sizes="100vw" />
          <img
            src={transparentPixel}
            width="1983"
            height="793"
            alt=""
            loading="eager"
            decoding="async"
            fetchPriority="high"
          />
        </picture>
        <span className="shop-hero__veil" aria-hidden="true" />
        <Container fluid="xl">
          <div className="shop-hero__copy">
            <p className="eyebrow">{heroCopy.eyebrow}</p>
            <h1>{heroCopy.title}{' '}<br /><em>{heroCopy.accent}</em></h1>
            <p>{heroCopy.description}</p>
          </div>
        </Container>
      </section>

      <section ref={catalogSectionRef} className="catalog-section page-section" aria-busy={loading}>
        <Container fluid="xl">
          {error && products.length > 0 && <Alert variant="warning" className="soft-alert catalog-alert">{error} <button type="button" className="plain-link" onClick={loadProducts}>Retry</button></Alert>}
          {truncated && <Alert variant="info" className="soft-alert catalog-alert">The studio has more pieces than this view could load. Refine the collection or try again shortly.</Alert>}
          <div className="catalog-toolbar">
            <div className="catalog-toolbar__summary">
              <Button ref={filterTriggerRef} variant="outline-dark" className="filter-trigger d-lg-none" onClick={openFilters}>
                <span className="filter-trigger__icon"><Icon name="spark" size={17} /></span>
                <span className="filter-trigger__label">Refine collection</span>
                {activeFilters.length > 0 && <span className="filter-trigger__count" aria-label={`${activeFilters.length} active filters`}>{activeFilters.length}</span>}
              </Button>
              <p aria-live="polite">{loading ? 'Loading studio pieces…' : <><strong>{filteredProducts.length}</strong> studio {filteredProducts.length === 1 ? 'piece' : 'pieces'}</>}</p>
            </div>
            <Form.Group className="sort-control" controlId="catalog-sort">
              <Form.Label>Sort by</Form.Label>
              <StorefrontSelect
                id="catalog-sort"
                value={filters.sort}
                options={sortOptions}
                onChange={(value) => setFilter('sort', value)}
                ariaLabel="Sort studio pieces"
              />
            </Form.Group>
          </div>

          {activeFilters.length > 0 && (
            <div className="active-filters" role="group" aria-label="Active filters">
              {activeFilters.map(([key, label]) => (
                <button type="button" key={key} onClick={() => setFilter(key, '')} aria-label={`Remove filter: ${label}`}>
                  <span>{label}</span>
                  <i aria-hidden="true"><Icon name="minus" size={13} /></i>
                </button>
              ))}
              <button type="button" className="clear-filter" onClick={clearFilters}>Clear all</button>
            </div>
          )}

          <Row className="g-4 catalog-layout">
            <Col lg={3} className="d-none d-lg-block">
              <aside className="catalog-sidebar" aria-label="Product filters">
                <div className="catalog-sidebar__head"><h2>Refine</h2>{activeFilters.length > 0 && <button type="button" className="plain-link" onClick={clearFilters}>Clear</button>}</div>
                <FilterPanel idPrefix="desktop" filters={filters} setFilter={setFilter} products={products} />
              </aside>
            </Col>
            <Col lg={9} className="catalog-results">
              {loading ? (
                <><p className="visually-hidden" role="status">Loading the studio collection…</p><Row className="g-3 g-md-4">{Array.from({ length: 6 }, (_, index) => <Col xs={6} lg={4} key={index}><ProductCardSkeleton /></Col>)}</Row></>
              ) : error && !products.length ? (
                <div className="catalog-empty catalog-empty--error" role="alert">
                  <span><Icon name="spark" size={30} /></span>
                  <h2>The collection didn’t reach us.</h2>
                  <p>Try loading the studio shelf again. Your filters will stay exactly as they are.</p>
                  <div><Button className="button-burgundy" onClick={loadProducts}>Try again</Button><Button as={Link} to="/custom-order" variant="link" className="text-link">Begin a custom piece <Icon name="arrow" /></Button></div>
                </div>
              ) : filteredProducts.length ? (
                <Row className="g-3 g-md-4 product-grid">
                  {filteredProducts.map((product, index) => <Col xs={6} lg={4} key={product.id}><ProductCard product={product} index={index} priority={index < 3} /></Col>)}
                </Row>
              ) : (
                <div className="catalog-empty">
                  <span><Icon name="spark" size={30} /></span>
                  <h2>{emptyCopy.title}</h2>
                  <p>{emptyCopy.description}</p>
                  <div>{activeFilters.length > 0 && <Button className="button-burgundy" onClick={clearFilters}>See all pieces</Button>} <Button as={Link} to="/custom-order" variant="link" className="text-link">Request a new design <Icon name="arrow" /></Button></div>
                </div>
              )}
            </Col>
          </Row>
        </Container>
      </section>

      <Offcanvas
        show={filtersOpen}
        onHide={closeFilters}
        onEntering={restoreFilterScrollPosition}
        onEntered={finishOpeningFilters}
        onExited={finishClosingFilters}
        autoFocus={false}
        restoreFocus={false}
        placement="bottom"
        className="filter-offcanvas"
        aria-labelledby="mobile-filter-title"
      >
        <Offcanvas.Header>
          <span className="filter-offcanvas__grabber" aria-hidden="true" />
          <div>
            <p className="eyebrow">Find your piece</p>
            <Offcanvas.Title as="h2" id="mobile-filter-title">Refine the collection</Offcanvas.Title>
            <p className="filter-offcanvas__summary">{activeFilters.length ? `${activeFilters.length} selected` : 'Choose only what matters to you'}</p>
          </div>
          <button ref={filterDoneRef} type="button" className="filter-offcanvas__done" onClick={closeFilters} aria-label="Close filters">Done</button>
        </Offcanvas.Header>
        <Offcanvas.Body><FilterPanel idPrefix="mobile" filters={filters} setFilter={setFilter} products={products} /></Offcanvas.Body>
        <div className="filter-offcanvas__footer">
          {activeFilters.length > 0 && <button type="button" className="filter-offcanvas__clear" onClick={clearFilters}>Clear all</button>}
          <Button className="button-burgundy" onClick={closeFilters} disabled={loading}>
            {loading ? 'Finding pieces…' : `Show ${formatPieceCount(filteredProducts.length)}`}
          </Button>
        </div>
      </Offcanvas>
    </>
  );
}
