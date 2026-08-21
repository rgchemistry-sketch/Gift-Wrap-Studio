import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../Icon';

/**
 * Keeps wide admin tables reachable without showing a misleading scroll hint
 * when every column already fits.
 */
export default function AdminTableShell({ children, className = '', loading = false }) {
  const shellRef = useRef(null);
  const [scrollState, setScrollState] = useState({ overflowing: false, atEnd: false });

  const measure = useCallback(() => {
    const scroller = shellRef.current?.querySelector('.table-responsive');
    if (!scroller) {
      setScrollState({ overflowing: false, atEnd: false });
      return;
    }
    const overflowing = scroller.scrollWidth > scroller.clientWidth + 2;
    const atEnd = !overflowing || scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 2;
    setScrollState((current) => (
      current.overflowing === overflowing && current.atEnd === atEnd
        ? current
        : { overflowing, atEnd }
    ));
  }, []);

  useEffect(() => {
    const scroller = shellRef.current?.querySelector('.table-responsive');
    if (!scroller) return undefined;
    const frame = window.requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(scroller);
    observer?.observe(scroller.firstElementChild || scroller);
    scroller.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      scroller.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [children, measure]);

  return (
    <div
      ref={shellRef}
      className={`admin-table-shell ${scrollState.overflowing ? 'has-horizontal-overflow' : ''} ${scrollState.atEnd ? 'is-at-end' : ''}`}
    >
      {scrollState.overflowing && (
        <p className="admin-table-scroll-hint" role="status">
          <Icon name="arrow" size={14} /> Scroll sideways to reach every column and action.
        </p>
      )}
      <div className={`admin-panel admin-table-panel ${loading ? 'is-updating' : ''} ${className}`} aria-busy={loading}>
        {children}
      </div>
    </div>
  );
}
