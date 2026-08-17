import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

// The storefront shows the catalogue on the home page, shop, product page, cart and
// account. They share one in-flight request and one cached result so a visit does not
// refetch the whole catalogue per route.
let cachedCatalog = null;
let inFlightCatalog = null;
const subscribers = new Set();

const publish = () => {
  subscribers.forEach((notify) => notify());
};

export function loadCatalog({ force = false } = {}) {
  if (force) {
    cachedCatalog = null;
    inFlightCatalog = null;
  }
  if (cachedCatalog) return Promise.resolve(cachedCatalog);
  if (!inFlightCatalog) {
    inFlightCatalog = api
      .getAllProducts()
      .then((result) => {
        cachedCatalog = { products: result.products, total: result.total };
        return cachedCatalog;
      })
      .finally(() => {
        inFlightCatalog = null;
        publish();
      });
  }
  return inFlightCatalog;
}

export function useCatalog() {
  const [state, setState] = useState(() => ({
    products: cachedCatalog?.products || [],
    loading: !cachedCatalog,
    error: '',
  }));

  const refresh = useCallback(async ({ force = false } = {}) => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const result = await loadCatalog({ force });
      setState({ products: result.products, loading: false, error: '' });
      return result.products;
    } catch (requestError) {
      // Fixture products used to stand in here. Showing an honest empty state is safer:
      // placeholder pieces were addable to the bag and then rejected at checkout.
      setState({ products: [], loading: false, error: requestError.message });
      return [];
    }
  }, []);

  useEffect(() => {
    let active = true;
    const sync = () => {
      if (!active || !cachedCatalog) return;
      setState({ products: cachedCatalog.products, loading: false, error: '' });
    };
    subscribers.add(sync);

    if (cachedCatalog) {
      sync();
    } else {
      loadCatalog()
        .then(() => active && sync())
        .catch((requestError) => {
          if (active) setState({ products: [], loading: false, error: requestError.message });
        });
    }

    return () => {
      active = false;
      subscribers.delete(sync);
    };
  }, []);

  return { ...state, refresh };
}
