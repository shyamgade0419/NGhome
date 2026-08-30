'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FolderOpen, FileText, Trash2, X, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { documentsApi } from '@/lib/api/endpoints';
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

const ACCESS_LEVEL_OPTIONS = [
  { value: 'PUBLIC', label: 'Public (everyone)' },
  { value: 'RESIDENTS_ONLY', label: 'Residents only' },
  { value: 'ADMIN_ONLY', label: 'Admin only' },
];

const CATEGORY_OPTIONS = [
  { value: '', label: 'All Categories' },
  { value: 'NOTICE', label: 'Notice' },
  { value: 'MINUTES', label: 'Meeting Minutes' },
  { value: 'FINANCIAL', label: 'Financial' },
  { value: 'LEGAL', label: 'Legal' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'OTHER', label: 'Other' },
];

function accessBadge(level: string) {
  if (level === 'PUBLIC') return <Badge variant="success">Public</Badge>;
  if (level === 'RESIDENTS_ONLY') return <Badge variant="info">Residents</Badge>;
  return <Badge variant="warning">Admin</Badge>;
}

function AddDocumentModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: '',
    description: '',
    fileName: '',
    fileKey: '',
    fileSize: '',
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
      fileSize: Number(form.fileSize) || 0,
      mimeType: form.mimeType.trim(),
      accessLevel: form.accessLevel,
      category: form.category || undefined,
    }),
    onSuccess: () => {
      toast.success('Document registered');
      qc.invalidateQueries({ queryKey: ['documents'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to add document'),
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const valid = form.title.trim() && form.fileName.trim() && form.fileKey.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Add Document</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <Input label="Title *" placeholder="AGM Notice 2025" value={form.title} onChange={set('title')} />
          <Input label="Description" placeholder="Brief description" value={form.description} onChange={set('description')} />
          <div className="grid grid-cols-2 gap-4">
            <Select label="Access Level" value={form.accessLevel} onChange={set('accessLevel')} options={ACCESS_LEVEL_OPTIONS} />
            <Select label="Category" value={form.category} onChange={set('category')}
              options={CATEGORY_OPTIONS.filter((o) => o.value).map((o) => ({ value: o.value, label: o.label }))} />
          </div>
          <Input label="File Name *" placeholder="agm_notice_2025.pdf" value={form.fileName} onChange={set('fileName')} />
          <Input label="File Key / URL *" placeholder="Storage path or URL" value={form.fileKey} onChange={set('fileKey')} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="File Size (bytes)" type="number" placeholder="102400" value={form.fileSize} onChange={set('fileSize')} />
            <Input label="MIME Type" placeholder="application/pdf" value={form.mimeType} onChange={set('mimeType')} />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!valid}>
            Add Document
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function DocumentsPage() {
  const { user, activeMembership } = useAuth();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [category, setCategory] = useState('');

  const isAdmin = activeMembership?.role === 'SOCIETY_ADMIN' || !!user?.isPlatformAdmin;

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
    onError: () => toast.error('Failed to remove document'),
  });

  const docs: any[] = Array.isArray(data) ? data : (data?.data ?? []);

  return (
    <>
      {showAdd && <AddDocumentModal onClose={() => setShowAdd(false)} />}
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
            {isAdmin && (
              <Button size="sm" onClick={() => setShowAdd(true)}>
                <Plus size={15} className="mr-1.5" /> Add Document
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
            description={isAdmin ? 'Upload notices, minutes, and important files.' : 'No documents have been published yet.'}
            action={isAdmin ? <Button size="sm" onClick={() => setShowAdd(true)}><Plus size={14} className="mr-1" /> Add</Button> : undefined}
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
              {docs.map((doc: any) => (
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
                      {doc.fileKey && (
                        <a
                          href={doc.fileKey}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          title="View / Download"
                        >
                          <Download size={14} />
                        </a>
                      )}
                      {isAdmin && (
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
              ))}
            </Tbody>
          </Table>
        )}
      </PageContainer>
    </>
  );
}
