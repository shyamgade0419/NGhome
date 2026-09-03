'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Home, Plus, Building2, X, ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react';
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

/* ─── Main Page ──────────────────────────────────────────────────────────── */
export default function FlatsPage() {
  const [showAddBuilding, setShowAddBuilding] = useState(false);
  const [showAddFlat, setShowAddFlat] = useState(false);
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

      <Header
        title="Flats"
        subtitle={`${buildings.length} building${buildings.length !== 1 ? 's' : ''} · ${allFlats.length} flat${allFlats.length !== 1 ? 's' : ''}`}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowAddBuilding(true)}>
              <Building2 size={15} className="mr-1.5" /> Add Building
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
