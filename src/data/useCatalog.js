import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

// The storefront shows the catalogue on the home page, shop, product page, cart and
// account. They share one in-flight request and one cached result so a visit does not
// refetch the whole catalogue per route.
let cachedCatalog = null;
let inFlightCatalog = null;
let catalogGeneration = 0;
const subscribers = new Set();

const publish = () => {
  subscribers.forEach((notify) => notify());
};

export function loadCatalog({ force = false } = {}) {
  if (force) {
    invalidateCatalog();
  }
  if (cachedCatalog) return Promise.resolve(cachedCatalog);
  if (!inFlightCatalog) {
    const generation = catalogGeneration;
    inFlightCatalog = api
      .getAllProducts()
      .then((result) => {
        const nextCatalog = {
          products: result.products,
          total: result.total,
          truncated: Boolean(result.truncated),
        };
        if (generation === catalogGeneration) cachedCatalog = nextCatalog;
        return nextCatalog;
      })
      .finally(() => {
        if (generation === catalogGeneration) inFlightCatalog = null;
        publish();
      });
  }
  return inFlightCatalog;
}

export function invalidateCatalog() {
  catalogGeneration += 1;
  cachedCatalog = null;
  inFlightCatalog = null;
  publish();
}

export function useCatalog() {
  const [state, setState] = useState(() => ({
    products: cachedCatalog?.products || [],
    truncated: Boolean(cachedCatalog?.truncated),
    loading: !cachedCatalog,
    error: '',
  }));

  const refresh = useCallback(async ({ force = false } = {}) => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const result = await loadCatalog({ force });
      setState({ products: result.products, truncated: Boolean(result.truncated), loading: false, error: '' });
      return result.products;
    } catch (requestError) {
      // Fixture products used to stand in here. Showing an honest empty state is safer:
      // placeholder pieces were addable to the bag and then rejected at checkout.
      setState({ products: [], truncated: false, loading: false, error: requestError.message });
      // Callers that gate a money-path action must be able to distinguish an
      // honestly empty catalogue from a catalogue that could not be checked.
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    const sync = () => {
      if (!active || !cachedCatalog) return;
      setState({ products: cachedCatalog.products, truncated: Boolean(cachedCatalog.truncated), loading: false, error: '' });
    };
    subscribers.add(sync);

    if (cachedCatalog) {
      sync();
    } else {
      loadCatalog()
        .then(() => active && sync())
        .catch((requestError) => {
          if (active) setState({ products: [], truncated: false, loading: false, error: requestError.message });
        });
    }

    return () => {
      active = false;
      subscribers.delete(sync);
    };
  }, []);

  return { ...state, refresh };
}
