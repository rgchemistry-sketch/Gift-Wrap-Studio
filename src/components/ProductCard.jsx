import { Link } from 'react-router-dom';
import Button from 'react-bootstrap/Button';
import Icon from './Icon';
import SmartImage from './SmartImage';
import { formatCurrency } from '../data/catalog';
import { useShop } from '../context/ShopContext';

export default function ProductCard({ product, index = 0 }) {
  const { addToCart, wishlist, toggleWishlist } = useShop();
  const saved = wishlist.includes(product.id);

  return (
    <article className="product-card reveal-card" style={{ '--reveal-delay': `${Math.min(index, 5) * 80}ms` }}>
      <div className="product-card__media">
        <Link to={`/product/${product.slug}`} aria-label={`View ${product.title}`}>
          <SmartImage
            src={product.image}
            alt={product.title}
            fallbackLabel={product.category}
            loading="lazy"
            decoding="async"
            imageWidth={600}
            responsiveWidths={[320, 480, 600, 800]}
            sizes="(max-width: 575px) calc(100vw - 1.5rem), (max-width: 991px) 50vw, 33vw"
          />
        </Link>
        {product.badge && <span className="product-card__badge">{product.badge}</span>}
        <button
          type="button"
          className={`icon-button product-card__save ${saved ? 'is-active' : ''}`}
          aria-label={saved ? `Remove ${product.title} from saved pieces` : `Save ${product.title}`}
          aria-pressed={saved}
          onClick={() => toggleWishlist(product.id)}
        >
          <Icon name="heart" size={19} />
        </button>
      </div>
      <div className="product-card__body">
        <p className="eyebrow product-card__category">{product.category}</p>
        <h3><Link to={`/product/${product.slug}`}>{product.title}</Link></h3>
        <div className="product-card__meta">
          <p className="price">
            {formatCurrency(product.price)}
            {product.compareAt && <del>{formatCurrency(product.compareAt)}</del>}
          </p>
          {product.customizable && <span className="customizable-dot">Customizable</span>}
        </div>
        <Button
          variant="link"
          className="text-link product-card__action"
          as={product.customizable || !product.inStock ? Link : 'button'}
          to={product.customizable || !product.inStock ? `/product/${product.slug}` : undefined}
          onClick={product.customizable || !product.inStock ? undefined : () => addToCart(product)}
        >
          {!product.inStock ? 'View details' : product.customizable ? 'Personalize this piece' : 'Add to bag'}
          <Icon name="arrow" size={17} />
        </Button>
      </div>
    </article>
  );
}
