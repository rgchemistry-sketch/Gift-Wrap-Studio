export const RAZORPAY_CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

let checkoutLoadPromise;

const checkoutConstructor = () => (
  typeof window !== 'undefined' && typeof window.Razorpay === 'function'
    ? window.Razorpay
    : null
);

export const loadRazorpayCheckout = () => {
  const ready = checkoutConstructor();
  if (ready) return Promise.resolve(ready);
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Secure checkout is available only in a browser.'));
  }
  if (checkoutLoadPromise) return checkoutLoadPromise;

  checkoutLoadPromise = new Promise((resolve, reject) => {
    let script = document.querySelector(`script[src="${RAZORPAY_CHECKOUT_SRC}"]`);
    const createdHere = !script;
    if (!script) {
      script = document.createElement('script');
      script.src = RAZORPAY_CHECKOUT_SRC;
      script.async = true;
      script.dataset.gnwPaymentProvider = 'razorpay';
    }

    let timeoutId;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
    };
    const handleLoad = () => {
      cleanup();
      const constructor = checkoutConstructor();
      if (constructor) {
        resolve(constructor);
        return;
      }
      checkoutLoadPromise = undefined;
      reject(new Error('Secure checkout loaded without becoming available. Please try again.'));
    };
    const handleError = () => {
      cleanup();
      if (createdHere) script.remove();
      checkoutLoadPromise = undefined;
      reject(new Error('Secure checkout could not load. Check your connection and try again.'));
    };

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    timeoutId = window.setTimeout(() => {
      handleError();
    }, 20_000);
    if (createdHere) document.head.appendChild(script);
  });

  return checkoutLoadPromise;
};
