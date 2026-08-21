import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import Button from 'react-bootstrap/Button';
import Spinner from 'react-bootstrap/Spinner';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import Icon from './Icon';
import {
  CUSTOM_REFERENCE_ACCEPT,
  CUSTOM_REFERENCE_MAX_FILES,
  initialReferenceUploadState,
  normalizeCustomReferenceImages,
  referenceUploadReducer,
  validateCustomReferenceFile,
} from '../utils/custom-reference-upload';
import { optimizeCloudinaryImage } from '../utils/cloudinary-image';
import '../custom-reference-upload.css';

export default function CustomReferenceUpload({
  images = [],
  ownerId = '',
  onChange,
  onBusyChange = () => {},
  error = '',
}) {
  const { user, requireAuth } = useAuth();
  const inputRef = useRef(null);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const imagesRef = useRef(images);
  const selectionRef = useRef(null);
  const replacePublicIdRef = useRef('');
  const [selection, setSelection] = useState(null);
  const [uploadState, dispatch] = useReducer(referenceUploadReducer, initialReferenceUploadState);
  const [removingPublicId, setRemovingPublicId] = useState('');
  const [cleanupWarning, setCleanupWarning] = useState('');
  const safeImages = normalizeCustomReferenceImages(images, { ownerId });
  const busy = uploadState.status === 'uploading' || Boolean(removingPublicId);

  useEffect(() => {
    imagesRef.current = safeImages;
  }, [safeImages]);

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  const clearSelection = useCallback(() => {
    generationRef.current += 1;
    if (selectionRef.current?.previewUrl) {
      URL.revokeObjectURL(selectionRef.current.previewUrl);
    }
    selectionRef.current = null;
    replacePublicIdRef.current = '';
    setSelection(null);
    dispatch({ type: 'reset' });
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  useEffect(() => {
    // React Strict Mode probes effects with setup -> cleanup -> setup in
    // development. Restore the mounted flag in setup so real uploads are not
    // mistaken for late completions after that probe.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      if (selectionRef.current?.previewUrl) {
        URL.revokeObjectURL(selectionRef.current.previewUrl);
      }
    };
  }, []);

  const askToSignIn = useCallback((retry) => {
    requireAuth({
      message: 'Log in or create an account to attach reference images securely. Your written brief and reference link are already saved.',
      onAuthenticated: retry,
      onAccountMismatch: () => {
        if (!mountedRef.current) return;
        dispatch({
          type: 'failed',
          error: 'A different account signed in. Choose the image again for that account.',
        });
      },
    });
  }, [requireAuth]);

  const uploadSelection = useCallback(async (
    file,
    replacePublicId = '',
    retry = false,
    authenticatedUser = user,
  ) => {
    if (!file || !mountedRef.current) return;
    if (!authenticatedUser) {
      dispatch({ type: 'failed', error: 'Sign in, then choose “Try again” to attach this preview.' });
      askToSignIn();
      return;
    }

    const operation = ++generationRef.current;
    dispatch({ type: retry ? 'retried' : 'started' });
    setCleanupWarning('');
    try {
      const uploaded = await api.uploadImage(file, 'custom-inquiries', {
        onProgress: (progress) => {
          if (mountedRef.current && generationRef.current === operation) {
            dispatch({ type: 'progress', value: progress });
          }
        },
      });
      const [verifiedImage] = normalizeCustomReferenceImages([{
        name: file.name,
        url: uploaded.url,
        publicId: uploaded.publicId,
        expiresAt: uploaded.expiresAt,
      }], { ownerId: authenticatedUser.id });

      if (!verifiedImage) {
        if (uploaded.publicId) void api.deleteUploadedAsset(uploaded.publicId).catch(() => {});
        throw new Error('The verified upload did not match this signed-in account. Choose the image again.');
      }
      if (!mountedRef.current || generationRef.current !== operation) {
        void api.deleteUploadedAsset(verifiedImage.publicId).catch(() => {});
        return;
      }

      const current = imagesRef.current;
      const replacementIndex = replacePublicId
        ? current.findIndex((image) => image.publicId === replacePublicId)
        : -1;
      const next = replacementIndex >= 0
        ? current.map((image, index) => (index === replacementIndex ? verifiedImage : image))
        : [...current, verifiedImage].slice(0, CUSTOM_REFERENCE_MAX_FILES);
      imagesRef.current = next;
      onChange(next);
      dispatch({ type: 'completed' });

      if (replacementIndex >= 0) {
        api.deleteUploadedAsset(replacePublicId).catch(() => {
          if (mountedRef.current) {
            setCleanupWarning('Your new image is attached. The previous upload will be removed automatically by the studio’s secure cleanup.');
          }
        });
      }
      clearSelection();
    } catch (error) {
      if (!mountedRef.current || generationRef.current !== operation) return;
      const message = error?.message || 'The reference image could not be uploaded.';
      dispatch({ type: 'failed', error: `${message} Your preview is still here.` });
      if (error?.status === 401) {
        requireAuth({
          force: true,
          message: 'Your session expired. Log in again to retry this reference image; your written brief remains saved.',
          onAuthenticated: () => {
            if (mountedRef.current) {
              dispatch({ type: 'failed', error: 'You’re signed in again. Choose “Try again” to finish this upload.' });
            }
          },
          onAccountMismatch: () => {
            if (mountedRef.current) {
              clearSelection();
              setCleanupWarning('A different account signed in, so the previous account’s local image preview was cleared.');
            }
          },
        });
      }
    }
  }, [askToSignIn, clearSelection, onChange, requireAuth, user]);

  const selectFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const validationError = validateCustomReferenceFile(file);
    if (validationError) {
      dispatch({ type: 'failed', error: validationError });
      event.target.value = '';
      return;
    }
    const replacePublicId = replacePublicIdRef.current;
    if (!replacePublicId && safeImages.length >= CUSTOM_REFERENCE_MAX_FILES) {
      dispatch({ type: 'failed', error: `You can attach up to ${CUSTOM_REFERENCE_MAX_FILES} reference images.` });
      event.target.value = '';
      return;
    }
    if (selectionRef.current?.previewUrl) URL.revokeObjectURL(selectionRef.current.previewUrl);
    const nextSelection = {
      file,
      previewUrl: URL.createObjectURL(file),
      replacePublicId,
    };
    selectionRef.current = nextSelection;
    setSelection(nextSelection);
    dispatch({ type: 'selected' });
    void uploadSelection(file, replacePublicId);
  };

  const openPicker = (replacePublicId = '') => {
    if (busy || !inputRef.current) return;
    replacePublicIdRef.current = replacePublicId;
    inputRef.current.value = '';
    inputRef.current.click();
  };

  const removeImage = async (image) => {
    if (busy) return;
    setRemovingPublicId(image.publicId);
    setCleanupWarning('');
    try {
      await api.deleteUploadedAsset(image.publicId);
      const next = imagesRef.current.filter((candidate) => candidate.publicId !== image.publicId);
      imagesRef.current = next;
      onChange(next);
    } catch (error) {
      if (error?.status === 404) {
        const next = imagesRef.current.filter((candidate) => candidate.publicId !== image.publicId);
        imagesRef.current = next;
        onChange(next);
      } else {
        setCleanupWarning(`${error?.message || 'The image could not be removed.'} Try removing it again.`);
      }
    } finally {
      if (mountedRef.current) setRemovingPublicId('');
    }
  };

  if (!user) {
    return (
      <section className="custom-reference-upload custom-reference-upload--guest" aria-labelledby="custom-reference-title">
        <div className="custom-reference-upload__heading">
          <span className="custom-reference-upload__mark"><Icon name="upload" /></span>
          <div>
            <h4 id="custom-reference-title">Add visual references</h4>
            <p>Images are optional. Your reference link and written details still work without them.</p>
          </div>
        </div>
        <div className="custom-reference-upload__guest-card">
          <Icon name="lock" />
          <div>
            <strong>Sign in before choosing an image</strong>
            <span>Uploads are tied to your account so another visitor can never attach or remove them.</span>
          </div>
          <Button type="button" className="button-burgundy" onClick={() => askToSignIn()}>
            Sign in to upload
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="custom-reference-upload" aria-labelledby="custom-reference-title">
      <div className="custom-reference-upload__heading">
        <span className="custom-reference-upload__mark"><Icon name="upload" /></span>
        <div>
          <h4 id="custom-reference-title">Add visual references <small>optional</small></h4>
          <p>Attach up to five JPG, PNG or WebP images, 8 MB each. They stay linked to this account.</p>
        </div>
        <span className="custom-reference-upload__count">{safeImages.length}/{CUSTOM_REFERENCE_MAX_FILES}</span>
      </div>

      <input
        ref={inputRef}
        id="custom-reference-files"
        className="visually-hidden"
        type="file"
        accept={CUSTOM_REFERENCE_ACCEPT}
        onChange={selectFile}
        disabled={busy}
        aria-describedby="custom-reference-files-help custom-reference-upload-status"
      />

      {safeImages.length > 0 && (
        <ul className="custom-reference-upload__list" aria-label="Attached reference images">
          {safeImages.map((image, index) => (
            <li key={image.publicId}>
              <img
                src={optimizeCloudinaryImage(image.url, 320)}
                alt={`Reference ${index + 1}: ${image.name}`}
                loading="lazy"
                decoding="async"
              />
              <div>
                <strong>{image.name}</strong>
                <span><Icon name="check" size={14} /> Securely attached</span>
                <div>
                  <button type="button" onClick={() => openPicker(image.publicId)} disabled={busy}>Replace</button>
                  <button type="button" onClick={() => void removeImage(image)} disabled={busy}>
                    {removingPublicId === image.publicId ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {selection ? (
        <div className="custom-reference-upload__preview">
          <img src={selection.previewUrl} alt={`Preview of ${selection.file.name}`} />
          <div>
            <strong>{selection.file.name}</strong>
            <p id="custom-reference-upload-status" role="status" aria-live="polite">
              {uploadState.status === 'uploading' && <><Spinner size="sm" /> Uploading and verifying… {uploadState.progress}%</>}
              {uploadState.status === 'error' && uploadState.error}
              {uploadState.status === 'ready' && 'Ready to upload securely.'}
            </p>
            {uploadState.status === 'uploading' && (
              <progress value={uploadState.progress} max="100" aria-label={`Reference image upload ${uploadState.progress}% complete`} />
            )}
            <div className="custom-reference-upload__preview-actions">
              {uploadState.status === 'error' && (
                <button type="button" onClick={() => void uploadSelection(selection.file, selection.replacePublicId, true)}>
                  Try again
                </button>
              )}
              <button type="button" onClick={clearSelection} disabled={uploadState.status === 'uploading'}>Remove preview</button>
            </div>
          </div>
        </div>
      ) : safeImages.length < CUSTOM_REFERENCE_MAX_FILES ? (
        <button type="button" className="custom-reference-upload__dropzone" onClick={() => openPicker()} disabled={busy}>
          <span><Icon name="plus" /></span>
          <strong>{safeImages.length ? 'Add another reference' : 'Choose reference images'}</strong>
          <small id="custom-reference-files-help">JPG, PNG or WebP · maximum 8 MB each</small>
        </button>
      ) : (
        <p className="custom-reference-upload__limit"><Icon name="check" /> Five references attached—the studio has plenty to begin.</p>
      )}

      {cleanupWarning && <p className="custom-reference-upload__message" role="alert">{cleanupWarning}</p>}
      {error && <p className="custom-reference-upload__message" role="alert">{error}</p>}
      <p className="custom-reference-upload__privacy"><Icon name="shield" size={15} /> Product inspiration only—please do not upload identity documents or other sensitive files.</p>
    </section>
  );
}
