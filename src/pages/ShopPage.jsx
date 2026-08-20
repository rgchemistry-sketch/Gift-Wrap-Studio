import { useMemo, useState } from 'react';
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
import { ProductCardSkeleton } from '../components/Feedback';
import { useCatalog } from '../data/useCatalog';

const priceOptions = [
  ['', 'All prices'],
  ['under-1500', 'Under ₹1,500'],
  ['1500-2500', '₹1,500 – ₹2,500'],
  ['over-2500', 'Over ₹2,500'],
];

function FilterPanel({ filters, setFilter, products, onDone, idPrefix }) {
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
      {onDone && <Button className="button-burgundy w-100 mt-4" onClick={onDone}>Show selected pieces</Button>}
    </div>
  );
}

export default function ShopPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { products, loading, error, truncated, refresh } = useCatalog();
  const [filtersOpen, setFiltersOpen] = useState(false);

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

  const setFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    const next = new URLSearchParams();
    if (filters.sort !== 'featured') next.set('sort', filters.sort);
    setSearchParams(next);
  };

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

  return (
    <>
      <section className="page-hero shop-hero">
        <Container fluid="xl">
          <p className="eyebrow">The studio collection</p>
          <h1>Made slowly.<br /><em>Kept forever.</em></h1>
          <p>Discover personalized gifts, sculptural clocks, table accents and memory-rich décor—finished by hand, one piece at a time.</p>
        </Container>
      </section>

      <section className="catalog-section page-section" aria-busy={loading}>
        <Container fluid="xl">
          {error && products.length > 0 && <Alert variant="warning" className="soft-alert catalog-alert">{error} <button type="button" className="plain-link" onClick={loadProducts}>Retry</button></Alert>}
          {truncated && <Alert variant="info" className="soft-alert catalog-alert">The studio has more pieces than this view could load. Refine the collection or try again shortly.</Alert>}
          <div className="catalog-toolbar">
            <div>
              <Button variant="outline-dark" className="filter-trigger d-lg-none" onClick={() => setFiltersOpen(true)}><Icon name="spark" size={17} /> Filters {activeFilters.length > 0 && <span>{activeFilters.length}</span>}</Button>
              <p aria-live="polite">{loading ? 'Loading studio pieces…' : <><strong>{filteredProducts.length}</strong> studio {filteredProducts.length === 1 ? 'piece' : 'pieces'}</>}</p>
            </div>
            <Form.Group className="sort-control" controlId="catalog-sort">
              <Form.Label>Sort by</Form.Label>
              <Form.Select value={filters.sort} onChange={(event) => setFilter('sort', event.target.value)}>
                <option value="featured">Featured</option>
                <option value="price-low">Price: low to high</option>
                <option value="price-high">Price: high to low</option>
                <option value="name">Name</option>
              </Form.Select>
            </Form.Group>
          </div>

          {activeFilters.length > 0 && (
            <div className="active-filters" aria-label="Active filters">
              {activeFilters.map(([key, label]) => (
                <button type="button" key={key} onClick={() => setFilter(key, '')}>{label} <Icon name="close" size={14} /></button>
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
            <Col lg={9}>
              {loading ? (
                <><p className="visually-hidden" role="status">Loading the studio collection…</p><Row className="g-4">{Array.from({ length: 6 }, (_, index) => <Col xs={12} sm={6} lg={4} key={index}><ProductCardSkeleton /></Col>)}</Row></>
              ) : error && !products.length ? (
                <div className="catalog-empty catalog-empty--error" role="alert">
                  <span><Icon name="spark" size={30} /></span>
                  <h2>The collection didn’t reach us.</h2>
                  <p>Try loading the studio shelf again. Your filters will stay exactly as they are.</p>
                  <div><Button className="button-burgundy" onClick={loadProducts}>Try again</Button><Button as={Link} to="/custom-order" variant="link" className="text-link">Begin a custom piece <Icon name="arrow" /></Button></div>
                </div>
              ) : filteredProducts.length ? (
                <Row className="g-4 product-grid">
                  {filteredProducts.map((product, index) => <Col xs={12} sm={6} lg={4} key={product.id}><ProductCard product={product} index={index} /></Col>)}
                </Row>
              ) : (
                <div className="catalog-empty">
                  <span><Icon name="spark" size={30} /></span>
                  <h2>No exact match—yet.</h2>
                  <p>Try removing a filter, or tell us what you imagined and we can create it especially for you.</p>
                  <div><Button className="button-burgundy" onClick={clearFilters}>See all pieces</Button> <Button as={Link} to="/custom-order" variant="link" className="text-link">Request a new design <Icon name="arrow" /></Button></div>
                </div>
              )}
            </Col>
          </Row>
        </Container>
      </section>

      <Offcanvas show={filtersOpen} onHide={() => setFiltersOpen(false)} placement="bottom" className="filter-offcanvas" aria-labelledby="mobile-filter-title">
        <Offcanvas.Header>
          <div><p className="eyebrow">Find your piece</p><Offcanvas.Title id="mobile-filter-title">Filter the collection</Offcanvas.Title></div>
          <button type="button" className="icon-button" onClick={() => setFiltersOpen(false)} aria-label="Close filters"><Icon name="close" /></button>
        </Offcanvas.Header>
        <Offcanvas.Body><FilterPanel idPrefix="mobile" filters={filters} setFilter={setFilter} products={products} onDone={() => setFiltersOpen(false)} /></Offcanvas.Body>
      </Offcanvas>
    </>
  );
}
