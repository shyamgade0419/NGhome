'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Home, Plus, Building2, X, ChevronDown, ChevronRight, Pencil, Trash2,
  Upload, Download, CheckCircle2, AlertCircle,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { societyApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { PageSpinner } from '@/components/ui/Spinner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import toast from 'react-hot-toast';
import { parseDecimalLike } from '@/lib/utils';

const statusVariant: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
  ACTIVE: 'success',
  VACANT: 'warning',
  UNDER_RENOVATION: 'default',
  INACTIVE: 'danger',
};

/* ─── Add Building Modal ─────────────────────────────────────────────────── */
function AddBuildingModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', code: '', totalFloors: '', description: '' });

  const mutation = useMutation({
    mutationFn: () =>
      societyApi.createBuilding({
        name: form.name.trim(),
        code: form.code.trim() || undefined,
        totalFloors: form.totalFloors ? parseInt(form.totalFloors) : undefined,
        description: form.description.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Building created');
      qc.invalidateQueries({ queryKey: ['buildings'] });
      qc.invalidateQueries({ queryKey: ['flats'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create building'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Add Building</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <Input
            label="Building Name *"
            placeholder="Block A"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            label="Code (optional)"
            placeholder="A"
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
          />
          <Input
            label="Total Floors (optional)"
            type="number"
            placeholder="10"
            value={form.totalFloors}
            onChange={(e) => setForm((f) => ({ ...f, totalFloors: e.target.value }))}
          />
          <Input
            label="Description (optional)"
            placeholder="Main residential block"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>

        <div className="mt-6 flex gap-3 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!form.name.trim()}
          >
            Create Building
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Edit Building Modal ────────────────────────────────────────────────── */
function EditBuildingModal({ building, onClose }: { building: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: building.name ?? '',
    code: building.code ?? '',
    totalFloors: building.totalFloors?.toString() ?? '',
    description: building.description ?? '',
  });

  const mutation = useMutation({
    mutationFn: () =>
      societyApi.updateBuilding(building.id, {
        name: form.name.trim(),
        code: form.code.trim() || undefined,
        totalFloors: form.totalFloors ? parseInt(form.totalFloors) : undefined,
        description: form.description.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Building updated');
      qc.invalidateQueries({ queryKey: ['buildings'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update building'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => societyApi.deleteBuilding(building.id),
    onSuccess: () => {
      toast.success('Building removed');
      qc.invalidateQueries({ queryKey: ['buildings'] });
      qc.invalidateQueries({ queryKey: ['flats'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to remove building'),
  });

  const handleDelete = () => {
    if (!confirm(`Remove "${building.name}"? Flats inside it are unaffected but will need reassigning.`)) return;
    deleteMutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Edit Building</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <Input
            label="Building Name *"
            placeholder="Block A"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            label="Code (optional)"
            placeholder="A"
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
          />
          <Input
            label="Total Floors (optional)"
            type="number"
            placeholder="10"
            value={form.totalFloors}
            onChange={(e) => setForm((f) => ({ ...f, totalFloors: e.target.value }))}
          />
          <Input
            label="Description (optional)"
            placeholder="Main residential block"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <Button variant="danger" onClick={handleDelete} loading={deleteMutation.isPending}>
            <Trash2 size={15} className="mr-1.5" /> Delete
          </Button>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => mutation.mutate()}
              loading={mutation.isPending}
              disabled={!form.name.trim()}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Add Flat Modal ─────────────────────────────────────────────────────── */
function AddFlatModal({ buildings, onClose }: { buildings: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    buildingId: buildings[0]?.id ?? '',
    unitNumber: '',
    flatCode: '',
    area: '',
    bedrooms: '',
    bathrooms: '',
    category: '',
    status: 'VACANT',
    ownershipType: '',
    parkingSlots: '',
  });

  const mutation = useMutation({
    mutationFn: () =>
      societyApi.createFlat({
        buildingId: form.buildingId,
        unitNumber: form.unitNumber.trim(),
        flatCode: form.flatCode.trim(),
        area: form.area ? parseFloat(form.area) : undefined,
        bedrooms: form.bedrooms ? parseInt(form.bedrooms) : undefined,
        bathrooms: form.bathrooms ? parseInt(form.bathrooms) : undefined,
        category: form.category.trim() || undefined,
        status: form.status || undefined,
        ownershipType: form.ownershipType.trim() || undefined,
        parkingSlots: form.parkingSlots ? parseInt(form.parkingSlots) : undefined,
      }),
    onSuccess: () => {
      toast.success('Flat created');
      qc.invalidateQueries({ queryKey: ['flats'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create flat'),
  });

  const f = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Add Flat</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Building */}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Building *</label>
            <select
              value={form.buildingId}
              onChange={f('buildingId')}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input label="Unit Number *" placeholder="101" value={form.unitNumber} onChange={f('unitNumber')} />
            <Input label="Flat Code *" placeholder="A-101" value={form.flatCode} onChange={f('flatCode')} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Input label="Area (sq ft)" type="number" placeholder="850" value={form.area} onChange={f('area')} />
            <Input label="Bedrooms" type="number" placeholder="2" value={form.bedrooms} onChange={f('bedrooms')} />
            <Input label="Bathrooms" type="number" placeholder="2" value={form.bathrooms} onChange={f('bathrooms')} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input label="Category" placeholder="2BHK" value={form.category} onChange={f('category')} />
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
              <select
                value={form.status}
                onChange={f('status')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="VACANT">Vacant</option>
                <option value="ACTIVE">Active</option>
                <option value="UNDER_RENOVATION">Under Renovation</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input label="Ownership Type" placeholder="OWNED / RENTED" value={form.ownershipType} onChange={f('ownershipType')} />
            <Input label="Parking Slots" type="number" placeholder="1" value={form.parkingSlots} onChange={f('parkingSlots')} />
          </div>
        </div>

        <div className="mt-6 flex gap-3 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!form.buildingId || !form.unitNumber.trim() || !form.flatCode.trim()}
          >
            Create Flat
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Edit Flat Modal ────────────────────────────────────────────────────── */
function EditFlatModal({ flat, buildings, onClose }: { flat: any; buildings: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    buildingId: flat.buildingId ?? buildings[0]?.id ?? '',
    unitNumber: flat.unitNumber ?? '',
    flatCode: flat.flatCode ?? '',
    area: flat.area != null ? String(parseDecimalLike(flat.area)) : '',
    bedrooms: flat.bedrooms?.toString() ?? '',
    bathrooms: flat.bathrooms?.toString() ?? '',
    category: flat.category ?? '',
    status: flat.status ?? 'VACANT',
    ownershipType: flat.ownershipType ?? '',
    parkingSlots: flat.parkingSlots?.toString() ?? '',
  });

  const mutation = useMutation({
    mutationFn: () =>
      societyApi.updateFlat(flat.id, {
        buildingId: form.buildingId,
        unitNumber: form.unitNumber.trim(),
        flatCode: form.flatCode.trim(),
        area: form.area ? parseFloat(form.area) : undefined,
        bedrooms: form.bedrooms ? parseInt(form.bedrooms) : undefined,
        bathrooms: form.bathrooms ? parseInt(form.bathrooms) : undefined,
        category: form.category.trim() || undefined,
        status: form.status || undefined,
        ownershipType: form.ownershipType.trim() || undefined,
        parkingSlots: form.parkingSlots ? parseInt(form.parkingSlots) : undefined,
      }),
    onSuccess: () => {
      toast.success('Flat updated');
      qc.invalidateQueries({ queryKey: ['flats'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update flat'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => societyApi.deleteFlat(flat.id),
    onSuccess: () => {
      toast.success('Flat removed');
      qc.invalidateQueries({ queryKey: ['flats'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to remove flat'),
  });

  const handleDelete = () => {
    if (!confirm(`Remove flat ${flat.flatCode}? This cannot be undone.`)) return;
    deleteMutation.mutate();
  };

  const f = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Edit Flat</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Building *</label>
            <select
              value={form.buildingId}
              onChange={f('buildingId')}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input label="Unit Number *" placeholder="101" value={form.unitNumber} onChange={f('unitNumber')} />
            <Input label="Flat Code *" placeholder="A-101" value={form.flatCode} onChange={f('flatCode')} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Input label="Area (sq ft)" type="number" placeholder="850" value={form.area} onChange={f('area')} />
            <Input label="Bedrooms" type="number" placeholder="2" value={form.bedrooms} onChange={f('bedrooms')} />
            <Input label="Bathrooms" type="number" placeholder="2" value={form.bathrooms} onChange={f('bathrooms')} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input label="Category" placeholder="2BHK" value={form.category} onChange={f('category')} />
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
              <select
                value={form.status}
                onChange={f('status')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="VACANT">Vacant</option>
                <option value="ACTIVE">Active</option>
                <option value="UNDER_RENOVATION">Under Renovation</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input label="Ownership Type" placeholder="OWNED / RENTED" value={form.ownershipType} onChange={f('ownershipType')} />
            <Input label="Parking Slots" type="number" placeholder="1" value={form.parkingSlots} onChange={f('parkingSlots')} />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <Button variant="danger" onClick={handleDelete} loading={deleteMutation.isPending}>
            <Trash2 size={15} className="mr-1.5" /> Delete
          </Button>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => mutation.mutate()}
              loading={mutation.isPending}
              disabled={!form.buildingId || !form.unitNumber.trim() || !form.flatCode.trim()}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Bulk Import Modal ──────────────────────────────────────────────────── */

const TEMPLATE_HEADERS = ['Building', 'Unit Number', 'Flat Code', 'Area', 'Bedrooms', 'Bathrooms', 'Category', 'Status', 'Ownership Type', 'Parking Slots'];
const VALID_STATUSES = ['VACANT', 'ACTIVE', 'UNDER_RENOVATION', 'INACTIVE'];

function normalizeKey(k: string) {
  return k.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function downloadFlatsTemplate() {
  const rows = [
    TEMPLATE_HEADERS,
    ['Block A', '101', 'A-101', '850', '2', '2', '2BHK', 'ACTIVE', 'OWNED', '1'],
  ];
  const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ng-home-flats-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

interface ParsedFlatRow {
  rowNum: number;
  buildingName: string;
  buildingId: string | null;
  unitNumber: string;
  flatCode: string;
  area: string;
  bedrooms: string;
  bathrooms: string;
  category: string;
  status: string;
  ownershipType: string;
  parkingSlots: string;
  errors: string[];
}

function BulkImportModal({ buildings, onClose }: { buildings: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'upload' | 'preview' | 'result'>('upload');
  const [rows, setRows] = useState<ParsedFlatRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<{
    createdCount: number;
    failedCount: number;
    failed: { row: number; flatCode?: string; error: string }[];
  } | null>(null);

  const buildingLookup = new Map<string, string>();
  buildings.forEach((b) => {
    buildingLookup.set(normalizeKey(b.name), b.id);
    if (b.code) buildingLookup.set(normalizeKey(b.code), b.id);
  });

  const handleFile = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb = XLSX.read(data, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        const parsed: ParsedFlatRow[] = json.map((raw, i) => {
          // Tolerant header matching — "Flat Code", "flat_code" and
          // "FlatCode" all resolve to the same key.
          const norm: Record<string, any> = {};
          Object.keys(raw).forEach((k) => { norm[normalizeKey(k)] = raw[k]; });

          const buildingName = String(norm['building'] ?? '').trim();
          const unitNumber = String(norm['unitnumber'] ?? norm['unit'] ?? '').trim();
          const flatCode = String(norm['flatcode'] ?? '').trim();
          const area = String(norm['area'] ?? norm['areasqft'] ?? '').trim();
          const bedrooms = String(norm['bedrooms'] ?? '').trim();
          const bathrooms = String(norm['bathrooms'] ?? '').trim();
          const category = String(norm['category'] ?? '').trim();
          let status = String(norm['status'] ?? '').trim().toUpperCase();
          const ownershipType = String(norm['ownershiptype'] ?? '').trim();
          const parkingSlots = String(norm['parkingslots'] ?? norm['parking'] ?? '').trim();

          const errors: string[] = [];
          const buildingId = buildingName ? buildingLookup.get(normalizeKey(buildingName)) ?? null : null;
          if (!buildingName) errors.push('Missing Building');
          else if (!buildingId) errors.push(`Unknown building "${buildingName}"`);
          if (!unitNumber) errors.push('Missing Unit Number');
          if (!flatCode) errors.push('Missing Flat Code');
          // An unrecognized status is a tolerant default, not a blocking
          // error — no reason to reject a whole row over a typo'd status.
          if (status && !VALID_STATUSES.includes(status)) status = 'VACANT';

          return {
            rowNum: i + 2, // +1 for 0-index, +1 for the header row
            buildingName, buildingId,
            unitNumber, flatCode, area, bedrooms, bathrooms, category,
            status: status || 'VACANT', ownershipType, parkingSlots,
            errors,
          };
        });

        setRows(parsed);
        setStep('preview');
      } catch {
        toast.error("Could not read that file — make sure it's a valid CSV or Excel file.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const validRows = rows.filter((r) => r.errors.length === 0);
  const invalidRows = rows.filter((r) => r.errors.length > 0);

  const importMutation = useMutation({
    mutationFn: () =>
      societyApi.bulkCreateFlats(
        validRows.map((r) => ({
          buildingId: r.buildingId!,
          unitNumber: r.unitNumber,
          flatCode: r.flatCode,
          area: r.area ? parseFloat(r.area) : undefined,
          bedrooms: r.bedrooms ? parseInt(r.bedrooms) : undefined,
          bathrooms: r.bathrooms ? parseInt(r.bathrooms) : undefined,
          category: r.category || undefined,
          status: r.status || undefined,
          ownershipType: r.ownershipType || undefined,
          parkingSlots: r.parkingSlots ? parseInt(r.parkingSlots) : undefined,
        })),
      ),
    onSuccess: (res) => {
      setResult(res.data);
      setStep('result');
      qc.invalidateQueries({ queryKey: ['flats'] });
      if (res.data.failedCount === 0) toast.success(`${res.data.createdCount} flats created`);
      else toast(`${res.data.createdCount} created, ${res.data.failedCount} failed`, { icon: '⚠️' });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Import failed'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Bulk Import Flats</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        {step === 'upload' && (
          <div className="space-y-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm text-slate-600">
                Import many flats at once from a spreadsheet — for a 60-flat building instead of
                adding them one by one. Download the template, fill it in (one row per flat), then upload it below.
              </p>
              <button
                onClick={downloadFlatsTemplate}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:underline"
              >
                <Download size={14} /> Download CSV template
              </button>
            </div>

            <div
              className="rounded-xl border-2 border-dashed border-slate-300 p-8 text-center hover:border-primary-400 transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) handleFile(file);
              }}
            >
              <Upload size={28} className="mx-auto mb-3 text-slate-400" />
              <p className="text-sm font-medium text-slate-700">Click to choose a file, or drag one here</p>
              <p className="mt-1 text-xs text-slate-400">.csv, .xlsx, or .xls</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
            </div>

            <div className="flex justify-end">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">{fileName}</span>
              <span className="font-medium">
                <span className="text-green-600">{validRows.length} ready</span>
                {invalidRows.length > 0 && <span className="text-red-500"> · {invalidRows.length} need fixing</span>}
              </span>
            </div>

            <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Row</Th>
                    <Th>Building</Th>
                    <Th>Unit</Th>
                    <Th>Flat Code</Th>
                    <Th>Issue</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((r) => (
                    <Tr key={r.rowNum}>
                      <Td>{r.rowNum}</Td>
                      <Td>{r.buildingName || '—'}</Td>
                      <Td>{r.unitNumber || '—'}</Td>
                      <Td>{r.flatCode || '—'}</Td>
                      <Td>
                        {r.errors.length === 0 ? (
                          <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">
                            <CheckCircle2 size={13} /> Ready
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-500 text-xs font-medium">
                            <AlertCircle size={13} /> {r.errors.join(', ')}
                          </span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>

            {invalidRows.length > 0 && (
              <p className="text-xs text-slate-500">
                Rows that need fixing will be skipped. Fix them in your file and re-upload, or continue
                with just the {validRows.length} ready row{validRows.length === 1 ? '' : 's'}.
              </p>
            )}

            <div className="flex justify-between gap-3">
              <Button variant="secondary" onClick={() => setStep('upload')}>Back</Button>
              <Button
                onClick={() => importMutation.mutate()}
                loading={importMutation.isPending}
                disabled={validRows.length === 0}
              >
                Import {validRows.length} Flat{validRows.length === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        )}

        {step === 'result' && result && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl bg-green-50 border border-green-200 p-4">
              <CheckCircle2 size={22} className="text-green-600" />
              <p className="text-sm font-semibold text-green-800">
                {result.createdCount} flat{result.createdCount === 1 ? '' : 's'} created
              </p>
            </div>

            {result.failedCount > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="mb-2 text-sm font-semibold text-red-700">{result.failedCount} failed</p>
                <ul className="space-y-1">
                  {result.failed.map((f) => (
                    <li key={f.row} className="text-xs text-red-600">
                      Row {f.row}{f.flatCode ? ` (${f.flatCode})` : ''}: {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────── */
export default function FlatsPage() {
  const [showAddBuilding, setShowAddBuilding] = useState(false);
  const [showAddFlat, setShowAddFlat] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [editingBuilding, setEditingBuilding] = useState<any>(null);
  const [editingFlat, setEditingFlat] = useState<any>(null);
  const [expandedBuildings, setExpandedBuildings] = useState<Record<string, boolean>>({});

  const { data: buildingsData, isLoading: buildingsLoading } = useQuery({
    queryKey: ['buildings'],
    queryFn: () => societyApi.buildings().then((r: any) => r.data),
  });

  const { data: flatsData, isLoading: flatsLoading } = useQuery({
    queryKey: ['flats'],
    queryFn: () => societyApi.flats({ limit: 500 }).then((r: any) => r.data),
  });

  const buildings: any[] = Array.isArray(buildingsData) ? buildingsData : (buildingsData?.data ?? []);
  const allFlats: any[] = flatsData?.data ?? [];

  const isLoading = buildingsLoading || flatsLoading;

  const toggleBuilding = (id: string) =>
    setExpandedBuildings((prev) => ({ ...prev, [id]: !prev[id] }));

  const flatsByBuilding = (buildingId: string) =>
    allFlats.filter((f) => f.buildingId === buildingId);

  return (
    <>
      {showAddBuilding && <AddBuildingModal onClose={() => setShowAddBuilding(false)} />}
      {showAddFlat && buildings.length > 0 && (
        <AddFlatModal buildings={buildings} onClose={() => setShowAddFlat(false)} />
      )}
      {editingBuilding && (
        <EditBuildingModal building={editingBuilding} onClose={() => setEditingBuilding(null)} />
      )}
      {editingFlat && (
        <EditFlatModal flat={editingFlat} buildings={buildings} onClose={() => setEditingFlat(null)} />
      )}
      {showBulkImport && buildings.length > 0 && (
        <BulkImportModal buildings={buildings} onClose={() => setShowBulkImport(false)} />
      )}

      <Header
        title="Flats"
        subtitle={`${buildings.length} building${buildings.length !== 1 ? 's' : ''} · ${allFlats.length} flat${allFlats.length !== 1 ? 's' : ''}`}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowAddBuilding(true)}>
              <Building2 size={15} className="mr-1.5" /> Add Building
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (buildings.length === 0) {
                  toast.error('Create a building first before importing flats');
                } else {
                  setShowBulkImport(true);
                }
              }}
            >
              <Upload size={15} className="mr-1.5" /> Import CSV/Excel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (buildings.length === 0) {
                  toast.error('Create a building first before adding flats');
                } else {
                  setShowAddFlat(true);
                }
              }}
            >
              <Plus size={15} className="mr-1.5" /> Add Flat
            </Button>
          </div>
        }
      />

      <PageContainer>
        {isLoading ? (
          <PageSpinner />
        ) : buildings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
              <Building2 size={28} className="text-slate-400" />
            </div>
            <h3 className="text-base font-semibold text-slate-900">No buildings yet</h3>
            <p className="mt-1 text-sm text-slate-500">Start by adding a building, then add flats inside it.</p>
            <Button className="mt-5" onClick={() => setShowAddBuilding(true)}>
              <Plus size={15} className="mr-1.5" /> Add Building
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {buildings.map((building) => {
              const bFlats = flatsByBuilding(building.id);
              const isOpen = expandedBuildings[building.id] !== false; // default open
              return (
                <div key={building.id} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  {/* Building header */}
                  <div className="flex w-full items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors">
                    <button
                      className="flex flex-1 items-center gap-3 text-left"
                      onClick={() => toggleBuilding(building.id)}
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50">
                        <Building2 size={16} className="text-primary-600" />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-semibold text-slate-900">{building.name}</p>
                        <p className="text-xs text-slate-500">
                          {building.code ? `Code: ${building.code} · ` : ''}
                          {bFlats.length} flat{bFlats.length !== 1 ? 's' : ''}
                          {building.totalFloors ? ` · ${building.totalFloors} floors` : ''}
                        </p>
                      </div>
                    </button>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditingBuilding(building)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        title="Edit building"
                      >
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => toggleBuilding(building.id)} className="p-1.5">
                        {isOpen ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                      </button>
                    </div>
                  </div>

                  {/* Flats table */}
                  {isOpen && (
                    bFlats.length === 0 ? (
                      <div className="border-t border-slate-100 px-5 py-6 text-center">
                        <Home size={20} className="mx-auto mb-2 text-slate-300" />
                        <p className="text-sm text-slate-400">No flats in this building yet</p>
                        <button
                          className="mt-2 text-xs font-medium text-primary-600 hover:underline"
                          onClick={() => setShowAddFlat(true)}
                        >
                          Add a flat
                        </button>
                      </div>
                    ) : (
                      <div className="border-t border-slate-100 overflow-x-auto">
                        <Table>
                          <Thead>
                            <Tr>
                              <Th>Flat Code</Th>
                              <Th>Unit</Th>
                              <Th>Category</Th>
                              <Th>Area (sq ft)</Th>
                              <Th>Bed / Bath</Th>
                              <Th>Parking</Th>
                              <Th>Status</Th>
                              <Th></Th>
                            </Tr>
                          </Thead>
                          <Tbody>
                            {bFlats.map((f: any) => (
                              <Tr key={f.id}>
                                <Td className="font-medium text-slate-900">{f.flatCode}</Td>
                                <Td>{f.unitNumber}</Td>
                                <Td className="text-slate-600">{f.category ?? '—'}</Td>
                                <Td className="text-slate-600">{f.area != null ? parseDecimalLike(f.area).toLocaleString('en-IN') : '—'}</Td>
                                <Td className="text-slate-600">
                                  {f.bedrooms != null ? `${f.bedrooms}B` : '—'}{f.bathrooms != null ? ` / ${f.bathrooms}Ba` : ''}
                                </Td>
                                <Td className="text-slate-600">{f.parkingSlots ?? '—'}</Td>
                                <Td>
                                  <Badge variant={statusVariant[f.status] ?? 'default'}>
                                    {f.status?.replace(/_/g, ' ')}
                                  </Badge>
                                </Td>
                                <Td>
                                  <button
                                    onClick={() => setEditingFlat(f)}
                                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                                    title="Edit flat"
                                  >
                                    <Pencil size={14} />
                                  </button>
                                </Td>
                              </Tr>
                            ))}
                          </Tbody>
                        </Table>
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </PageContainer>
    </>
  );
}
