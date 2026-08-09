import { Component } from 'react';
import Icon from './Icon';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) console.error('Gift N Wrap UI error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="fatal-error">
          <div className="fatal-error__mark"><Icon name="spark" size={30} /></div>
          <p className="eyebrow">Something didn’t set correctly</p>
          <h1>The studio page needs a fresh pour.</h1>
          <p>Your bag is safely stored on this device. Reload the page, or return home and try again.</p>
          <div>
            <button type="button" className="button-burgundy btn" onClick={() => window.location.reload()}>Reload page</button>
            <a href="/" className="text-link">Return home <Icon name="arrow" /></a>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
