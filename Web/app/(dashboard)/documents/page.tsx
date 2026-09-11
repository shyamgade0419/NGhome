'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FolderOpen, FileText, Trash2, X, Download, Link as LinkIcon, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { documentsApi, societyApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { formatDate, formatFileSize } from '@/lib/utils';
import { useAuth } from '@/lib/auth/AuthContext';
import { can, picksOwnDocumentAccess } from '@/lib/permissions';

// Mirrors the backend's DocumentAccessLevel enum exactly (App/prisma/schema.prisma)
// and the set staff/admin may pick from (DocumentsService.ADMIN_SELECTABLE_LEVELS).
// A resident never sees this — their upload is always forced to FLAT_PRIVATE
// server-side, regardless of what the client sends.
const STAFF_ACCESS_LEVEL_OPTIONS = [
  { value: 'PUBLIC', label: 'Public — everyone, including guests' },
  { value: 'RESIDENTS_ONLY', label: 'Residents only' },
  { value: 'COMMITTEE_ONLY', label: 'Committee only' },
  { value: 'ADMIN_ONLY', label: 'Admin only' },
  { value: 'FLAT_PRIVATE', label: 'Private to one flat' },
];

// Must agree with StoragePathService's folderFromCategory (App/src/documents/
// storage-path.service.ts) — an unrecognised category safely falls back to
// the "documents" folder there, so adding a value here needs no backend change.
const CATEGORY_OPTIONS = [
  { value: '', label: 'All Categories' },
  { value: 'NOTICE', label: 'Notice' },
  { value: 'MINUTES', label: 'Meeting Minutes' },
  { value: 'FINANCIAL', label: 'Financial' },
  { value: 'LEGAL', label: 'Legal' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'OTHER', label: 'Other' },
];

// Matches App/src/documents/file-safety.ts's ALLOWED_EXTENSIONS — a
// client-side hint only, so people don't fill the whole form before
// finding out. The backend re-checks this from the real file bytes/
// extension regardless of what the browser reports.
const ACCEPTED_FILE_TYPES =
  '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.txt,.csv,.doc,.docx,.xls,.xlsx';
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function accessBadge(level: string) {
  if (level === 'PUBLIC') return <Badge variant="success">Public</Badge>;
  if (level === 'RESIDENTS_ONLY') return <Badge variant="info">Residents</Badge>;
  if (level === 'FLAT_PRIVATE') return <Badge variant="warning">Private (flat)</Badge>;
  if (level === 'COMMITTEE_ONLY') return <Badge variant="warning">Committee</Badge>;
  return <Badge variant="warning">Admin</Badge>;
}

function UploadDocumentModal({ onClose, canPickAccess }: { onClose: () => void; canPickAccess: boolean }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('OTHER');
  const [accessLevel, setAccessLevel] = useState('RESIDENTS_ONLY');
  const [flatId, setFlatId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');

  // Only fetched when actually needed (FLAT_PRIVATE picked by staff/admin) —
  // a resident never sees this, their own flat is used server-side.
  const { data: flatsData } = useQuery({
    queryKey: ['documents-flats'],
    queryFn: () => societyApi.flats({ limit: 500 }).then((r: any) => r.data ?? r),
    enabled: canPickAccess && accessLevel === 'FLAT_PRIVATE',
  });
  const flats: any[] = Array.isArray(flatsData) ? flatsData : (flatsData?.data ?? []);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    setFileError('');
    if (picked && picked.size > MAX_FILE_BYTES) {
      setFile(null);
      setFileError(`File is too large (${formatFileSize(picked.size)}). The limit is 10 MB.`);
      return;
    }
    setFile(picked);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('file', file as File);
      form.append('title', title.trim());
      if (description.trim()) form.append('description', description.trim());
      if (category) form.append('category', category);
      // These two only matter server-side for staff/admin — a resident's
      // upload is forced to FLAT_PRIVATE on their own flat regardless.
      if (canPickAccess) {
        form.append('accessLevel', accessLevel);
        if (accessLevel === 'FLAT_PRIVATE' && flatId) form.append('flatId', flatId);
      }

      // Goes through the dedicated multipart BFF route, not the generic
      // JSON proxy — see Web/app/api/backend-file/documents/route.ts.
      const res = await fetch('/api/backend-file/documents', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? 'Upload failed');
      return data;
    },
    onSuccess: () => {
      toast.success('Document uploaded');
      qc.invalidateQueries({ queryKey: ['documents'] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? 'Failed to upload document'),
  });

  const valid =
    title.trim().length > 0 &&
    !!file &&
    !fileError &&
    (!canPickAccess || accessLevel !== 'FLAT_PRIVATE' || !!flatId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Upload Document</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <Input label="Title *" placeholder="AGM Notice 2025" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input label="Description" placeholder="Brief description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="grid grid-cols-2 gap-4">
            {canPickAccess ? (
              <Select label="Access Level" value={accessLevel} onChange={(e) => setAccessLevel(e.target.value)} options={STAFF_ACCESS_LEVEL_OPTIONS} />
            ) : (
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-slate-700">Access Level</span>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Private to your flat
                </div>
              </div>
            )}
            <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)}
              options={CATEGORY_OPTIONS.filter((o) => o.value)} />
          </div>
          {canPickAccess && accessLevel === 'FLAT_PRIVATE' && (
            <Select
              label="Flat *"
              value={flatId}
              onChange={(e) => setFlatId(e.target.value)}
              placeholder="Select a flat"
              options={flats.map((f: any) => ({ value: f.id, label: f.flatCode }))}
            />
          )}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">File *</label>
            <input
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              onChange={onFileChange}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100"
            />
            {fileError ? (
              <p className="text-xs text-red-600">{fileError}</p>
            ) : (
              <p className="text-xs text-slate-500">PDF, image, Word, Excel, text or CSV — up to 10 MB.</p>
            )}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!valid}>
            Upload
          </Button>
        </div>
      </div>
    </div>
  );
}

function LinkDocumentModal({ onClose, canPickAccess }: { onClose: () => void; canPickAccess: boolean }) {
  const qc = useQueryClient();
  const accessOptions = canPickAccess
    ? STAFF_ACCESS_LEVEL_OPTIONS.filter((o) => o.value !== 'FLAT_PRIVATE') // needs a flat picker this simpler form doesn't have
    : [];
  const [form, setForm] = useState({
    title: '',
    description: '',
    fileName: '',
    fileKey: '',
    mimeType: 'application/pdf',
    accessLevel: 'RESIDENTS_ONLY',
    category: 'OTHER',
  });

  const mutation = useMutation({
    mutationFn: () => documentsApi.create({
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      fileName: form.fileName.trim(),
      fileKey: form.fileKey.trim(),
      fileSize: 0,
      mimeType: form.mimeType.trim(),
      accessLevel: form.accessLevel,
      category: form.category || undefined,
    }),
    onSuccess: () => {
      toast.success('Link added');
      qc.invalidateQueries({ queryKey: ['documents'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to add link'),
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // Only http(s) — never javascript:, data:, vbscript: or any other scheme
  // that would run in the browser instead of just linking to a file.
  const url = form.fileKey.trim();
  const validUrl = (() => {
    if (!url) return false;
    try {
      return ['http:', 'https:'].includes(new URL(url).protocol);
    } catch {
      return false;
    }
  })();
  const valid = form.title.trim() && form.fileName.trim() && validUrl;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Add a Link</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <Input label="Title *" placeholder="AGM Notice 2025" value={form.title} onChange={set('title')} />
          <Input label="Description" placeholder="Brief description" value={form.description} onChange={set('description')} />
          <div className="grid grid-cols-2 gap-4">
            {canPickAccess ? (
              <Select label="Access Level" value={form.accessLevel} onChange={set('accessLevel')} options={accessOptions} />
            ) : (
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-slate-700">Access Level</span>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Private to your flat
                </div>
              </div>
            )}
            <Select label="Category" value={form.category} onChange={set('category')}
              options={CATEGORY_OPTIONS.filter((o) => o.value)} />
          </div>
          <Input label="File Name *" placeholder="agm_notice_2025.pdf" value={form.fileName} onChange={set('fileName')} />
          <Input
            label="Link URL *"
            placeholder="https://…"
            value={form.fileKey}
            onChange={set('fileKey')}
            error={url && !validUrl ? 'Must be a valid http:// or https:// link' : undefined}
          />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!valid}>
            Add Link
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function DocumentsPage() {
  const { user, activeMembership } = useAuth();
  const qc = useQueryClient();
  const [modal, setModal] = useState<null | 'upload' | 'link'>(null);
  const [category, setCategory] = useState('');

  const role = activeMembership?.role;
  const isPlatformAdmin = !!user?.isPlatformAdmin;
  const isAdmin = role === 'SOCIETY_ADMIN' || isPlatformAdmin;
  const canUpload = can.uploadDocument(role, isPlatformAdmin);
  const canLink = can.linkDocument(role, isPlatformAdmin);
  // A resident always gets FLAT_PRIVATE forced onto their own flat
  // server-side (DocumentsService.resolveAccessAndFlat); staff/admin/
  // committee choose from the full set. Mirrored here only to decide what
  // the form shows — the backend re-derives this itself either way.
  const canPickAccess = picksOwnDocumentAccess(role);

  const { data, isLoading } = useQuery({
    queryKey: ['documents', category],
    queryFn: () => documentsApi.list({ category: category || undefined }).then((r: any) => r.data ?? r),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => documentsApi.remove(id),
    onSuccess: () => {
      toast.success('Document removed');
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to remove document'),
  });

  const docs: any[] = Array.isArray(data) ? data : (data?.data ?? []);

  return (
    <>
      {modal === 'upload' && <UploadDocumentModal canPickAccess={canPickAccess} onClose={() => setModal(null)} />}
      {modal === 'link' && <LinkDocumentModal canPickAccess={canPickAccess} onClose={() => setModal(null)} />}
      <Header
        title="Documents"
        actions={
          <div className="flex items-center gap-2">
            <Select
              label=""
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={CATEGORY_OPTIONS}
              className="w-44"
            />
            {canLink && (
              <Button size="sm" variant="secondary" onClick={() => setModal('link')}>
                <LinkIcon size={15} className="mr-1.5" /> Add Link
              </Button>
            )}
            {canUpload && (
              <Button size="sm" onClick={() => setModal('upload')}>
                <Upload size={15} className="mr-1.5" /> Upload
              </Button>
            )}
          </div>
        }
      />
      <PageContainer>
        {isLoading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : docs.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title="No documents"
            description="Upload notices, minutes, and important files."
            action={canUpload ? <Button size="sm" onClick={() => setModal('upload')}><Plus size={14} className="mr-1" /> Upload</Button> : undefined}
          />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Document</Th>
                <Th>Category</Th>
                <Th>Access</Th>
                <Th>Size</Th>
                <Th>Uploaded</Th>
                <Th></Th>
              </Tr>
            </Thead>
            <Tbody>
              {docs.map((doc: any) => {
                // An SFTP-backed document never carries its server path to the
                // browser (DocumentsService blanks fileKey for these — see
                // toClient() in documents.service.ts); it's opened through the
                // authenticated backend endpoint instead. A link document's
                // fileKey is the external URL itself and is safe to use directly.
                const isUpload = doc.storageProvider === 'sftp';
                const href = isUpload ? `/api/backend-file/documents/${doc.id}/file` : doc.fileKey;
                const canDelete = isAdmin || (doc.accessLevel === 'FLAT_PRIVATE' && doc.uploadedBy?.id === user?.id);
                return (
                  <Tr key={doc.id}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <FileText size={15} className="text-slate-400 flex-shrink-0" />
                        <div>
                          <p className="font-medium text-slate-900">{doc.title}</p>
                          {doc.description && <p className="text-xs text-slate-500">{doc.description}</p>}
                          <p className="text-xs text-slate-400 font-mono">{doc.fileName}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <span className="text-sm text-slate-600">{doc.category ?? '—'}</span>
                    </Td>
                    <Td>{accessBadge(doc.accessLevel)}</Td>
                    <Td>
                      <span className="text-sm text-slate-600">{doc.fileSize ? formatFileSize(doc.fileSize) : '—'}</span>
                    </Td>
                    <Td>
                      <span className="text-sm text-slate-500">{formatDate(doc.createdAt)}</span>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        {href && (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            title="View / Download"
                          >
                            <Download size={14} />
                          </a>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => {
                              if (confirm(`Remove "${doc.title}"?`)) removeMutation.mutate(doc.id);
                            }}
                            className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                            title="Remove"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </PageContainer>
    </>
  );
}
