'use client';

/**
 * Committee: staff attendance. Day: each person's planned shift and what was recorded, with a
 * dropdown to mark or correct it (guards also check people in and out at the gate, in the mobile app).
 * Roster: who works which shift on which date. Summary: a month's counts per person: the
 * information the person doing salaries needs, which changes no salary by itself. Shifts: the
 * society's named working periods.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { staffAttendanceApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { fmtTime } from '@/lib/amenities';
import {
  STATUS_LABEL, STATUS_OPTIONS, STATUS_VARIANT, WEEKDAYS, addDays, dayLabel, hours, istToday, monthOf, shiftMonth, shiftSpan, weekStart,
  type AttendanceStatus, type DayRow, type Shift,
} from '@/lib/attendance';

type Tab = 'day' | 'roster' | 'summary' | 'shifts';

const errorMessage = (e: any, fallback: string) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : m || fallback;
};

const inputCls = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';

/** "06:05" in India time from an ISO instant, for the time inputs. */
const hhmm = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

function useStaff() {
  return useQuery({ queryKey: ['att-staff'], queryFn: () => staffAttendanceApi.staff().then((r) => r.data), staleTime: 60_000 });
}
function useShifts() {
  return useQuery({ queryKey: ['att-shifts'], queryFn: () => staffAttendanceApi.shifts().then((r) => r.data) });
}

// ─── Day ─────────────────────────────────────────────────────────────────────

function DayTab() {
  const qc = useQueryClient();
  const today = istToday();
  const [date, setDate] = useState(today);
  const [editing, setEditing] = useState<DayRow | null>(null);
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<AttendanceStatus>('PRESENT');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['att-day', date],
    queryFn: () => staffAttendanceApi.day(date).then((r) => r.data),
    refetchInterval: 30_000,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['att-day'] });
    qc.invalidateQueries({ queryKey: ['att-summary'] });
  };
  const fail = (what: string) => (e: unknown) => { refresh(); toast.error(errorMessage(e, what)); };

  const mark = useMutation({
    mutationFn: (b: { employeeId: string; status: AttendanceStatus; checkIn?: string; checkOut?: string; note?: string }) => staffAttendanceApi.mark({ date, ...b }),
    onSuccess: () => { refresh(); setEditing(null); },
    onError: fail('Could not save'),
  });
  const markAll = useMutation({
    mutationFn: (ids: string[]) => staffAttendanceApi.markDay(date, ids.map((employeeId) => ({ employeeId, status: 'PRESENT' as const }))),
    onSuccess: (res: any) => { toast.success(`Marked ${res.data?.marked ?? ''} present`); refresh(); },
    onError: fail('Could not mark'),
  });

  const rows = data?.rows ?? [];
  const unmarked = rows.filter((r) => !r.attendance && !r.dayOff);
  const open = (r: DayRow) => {
    setEditing(r);
    setStatus(r.attendance?.status ?? 'PRESENT');
    setCheckIn(hhmm(r.attendance?.checkInAt ?? null));
    setCheckOut(hhmm(r.attendance?.checkOutAt ?? null));
    setNote(r.attendance?.note ?? '');
  };
  const withTimes = status === 'PRESENT' || status === 'HALF_DAY';

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day"><ChevronLeft size={14} /></Button>
          <input type="date" aria-label="Date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className={inputCls} />
          <Button variant="outline" size="sm" disabled={date >= today} onClick={() => setDate(addDays(date, 1))} aria-label="Next day"><ChevronRight size={14} /></Button>
          {date !== today && <Button variant="ghost" size="sm" onClick={() => setDate(today)}>Today</Button>}
        </div>
        <Button size="sm" disabled={unmarked.length === 0} loading={markAll.isPending} onClick={() => markAll.mutate(unmarked.map((r) => r.employeeId))}>
          Mark {unmarked.length || ''} unmarked present
        </Button>
      </div>

      <Card padding="none">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : isError ? (
          <EmptyState icon={ClipboardCheck} title="Could not load the day" description="Check your connection and refresh the page." />
        ) : !rows.length ? (
          <EmptyState icon={ClipboardCheck} title="No staff yet" description="Staff are added under Salaries. Once added they appear here." />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Person</Th>
                <Th>Planned</Th>
                <Th>Status</Th>
                <Th>In</Th>
                <Th>Out</Th>
                <Th>Hours</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((r) => {
                const a = r.attendance;
                return (
                  <Tr key={r.employeeId}>
                    <Td>
                      <div className="font-medium text-slate-900">{r.name}</div>
                      <div className="text-xs text-slate-500">{r.designation}</div>
                    </Td>
                    <Td className="text-sm">
                      {r.shift ? <>{r.shift.name} <span className="text-xs text-slate-500">{shiftSpan(r.shift)}</span>{r.post && <div className="text-xs text-slate-500">{r.post}</div>}</> : r.dayOff ? <span className="text-slate-500">Day off</span> : <span className="text-slate-400">—</span>}
                    </Td>
                    <Td>
                      <Select
                        aria-label={`Status for ${r.name}`}
                        value={a?.status ?? ''}
                        placeholder="Not marked"
                        options={STATUS_OPTIONS}
                        onChange={(e) => e.target.value && mark.mutate({ employeeId: r.employeeId, status: e.target.value as AttendanceStatus })}
                      />
                      {a?.late && <Badge variant="warning">Late</Badge>}
                    </Td>
                    <Td className="whitespace-nowrap text-sm">{a?.checkInAt ? fmtTime(a.checkInAt) : '—'}</Td>
                    <Td className="whitespace-nowrap text-sm">{a?.checkOutAt ? fmtTime(a.checkOutAt) : '—'}</Td>
                    <Td className="whitespace-nowrap text-sm">{hours(a?.workedMinutes)}</Td>
                    <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => open(r)}>Edit</Button></Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </Card>

      <Modal open={!!editing} onClose={() => !mark.isPending && setEditing(null)} title={editing ? `${editing.name} · ${dayLabel(date)}` : 'Edit'}>
        {editing && (
          <div className="space-y-4">
            <Select label="Status" options={STATUS_OPTIONS} value={status} onChange={(e) => setStatus(e.target.value as AttendanceStatus)} />
            {withTimes ? (
              <div className="grid grid-cols-2 gap-3">
                <Input label="In" type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
                <Input label="Out" type="time" value={checkOut} disabled={!checkIn} onChange={(e) => setCheckOut(e.target.value)} hint="Earlier than In means the next morning" />
              </div>
            ) : (
              <p className="text-xs text-slate-500">Absent and leave carry no times; any recorded at the gate are cleared.</p>
            )}
            <Input label="Note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            <div className="flex justify-end gap-3">
              <Button variant="outline" disabled={mark.isPending} onClick={() => setEditing(null)}>Cancel</Button>
              <Button loading={mark.isPending} onClick={() => mark.mutate({ employeeId: editing.employeeId, status, ...(withTimes && checkIn ? { checkIn } : {}), ...(withTimes && checkIn && checkOut ? { checkOut } : {}), note: note.trim() || undefined })}>Save</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

// ─── Roster ──────────────────────────────────────────────────────────────────

function RosterModal({ open, onClose, defaultFrom }: { open: boolean; onClose: () => void; defaultFrom: string }) {
  const qc = useQueryClient();
  const { data: staff } = useStaff();
  const { data: shifts } = useShifts();
  const [clear, setClear] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(addDays(defaultFrom, 6));
  const [shiftId, setShiftId] = useState('');
  const [post, setPost] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([]);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const active = (shifts ?? []).filter((s) => s.active);

  const save = useMutation({
    mutationFn: () =>
      clear
        ? staffAttendanceApi.clear({ employeeIds: ids, from, to })
        : staffAttendanceApi.assign({ employeeIds: ids, from, to, shiftId: shiftId || null, post: post.trim() || undefined, weekdays: weekdays.length ? weekdays : undefined }),
    onSuccess: (res: any) => {
      toast.success(clear ? `Cleared ${res.data?.cleared} entries` : `Planned ${res.data?.assigned} days`);
      qc.invalidateQueries({ queryKey: ['att-roster'] });
      qc.invalidateQueries({ queryKey: ['att-day'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not save the roster')),
  });

  const valid = ids.length > 0 && !!from && !!to && to >= from;

  return (
    <Modal open={open} onClose={() => !save.isPending && onClose()} title={clear ? 'Clear the roster' : 'Plan the roster'}>
      <div className="space-y-4">
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">People</p>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {(staff ?? []).map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={ids.includes(s.id)} onChange={() => setIds(toggle(ids, s.id))} /> {s.name} <span className="text-xs text-slate-500">{s.designation}</span>
              </label>
            ))}
            {!(staff ?? []).length && <p className="text-xs text-slate-500">No staff yet.</p>}
          </div>
          {!!(staff ?? []).length && <Button variant="ghost" size="sm" onClick={() => setIds(ids.length === (staff ?? []).length ? [] : (staff ?? []).map((s) => s.id))}>{ids.length === (staff ?? []).length ? 'Select none' : 'Select all'}</Button>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label="To" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
        {!clear && (
          <>
            <Select label="Shift" value={shiftId} onChange={(e) => setShiftId(e.target.value)} placeholder="Day off" options={active.map((s) => ({ value: s.id, label: `${s.name} (${shiftSpan(s)})` }))} />
            {shiftId && <Input label="Post" value={post} maxLength={60} placeholder="e.g. Main gate (optional)" onChange={(e) => setPost(e.target.value)} />}
            <div>
              <p className="mb-1 text-sm font-medium text-slate-700">Only these days <span className="font-normal text-slate-500">(none ticked means every day)</span></p>
              <div className="flex flex-wrap gap-3">
                {WEEKDAYS.map((w) => (
                  <label key={w.value} className="flex items-center gap-1 text-sm text-slate-700"><input type="checkbox" checked={weekdays.includes(w.value)} onChange={() => setWeekdays(toggle(weekdays, w.value))} /> {w.label}</label>
                ))}
              </div>
            </div>
            <p className="text-xs text-slate-500">This replaces whatever was planned for those people on those days. Choosing no shift plans a day off.</p>
          </>
        )}
        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" size="sm" onClick={() => setClear((c) => !c)}>{clear ? 'Plan instead' : 'Clear instead'}</Button>
          <div className="flex gap-3">
            <Button variant="outline" disabled={save.isPending} onClick={onClose}>Cancel</Button>
            <Button variant={clear ? 'danger' : 'primary'} loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{clear ? 'Clear' : 'Save plan'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function RosterTab() {
  const [start, setStart] = useState(weekStart(istToday()));
  const [planning, setPlanning] = useState(false);
  const end = addDays(start, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const { data: staff } = useStaff();
  const { data, isLoading, isError } = useQuery({ queryKey: ['att-roster', start], queryFn: () => staffAttendanceApi.roster(start, end).then((r) => r.data) });
  const cell = new Map((data ?? []).map((r) => [`${r.employeeId}|${r.date}`, r]));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setStart(addDays(start, -7))} aria-label="Previous week"><ChevronLeft size={14} /></Button>
          <span className="text-sm font-medium text-slate-700">{dayLabel(start)} – {dayLabel(end)}</span>
          <Button variant="outline" size="sm" onClick={() => setStart(addDays(start, 7))} aria-label="Next week"><ChevronRight size={14} /></Button>
          <Button variant="ghost" size="sm" onClick={() => setStart(weekStart(istToday()))}>This week</Button>
        </div>
        <Button size="sm" onClick={() => setPlanning(true)}><Plus size={14} className="mr-1" /> Plan shifts</Button>
      </div>

      <Card padding="none">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : isError ? (
          <EmptyState icon={ClipboardCheck} title="Could not load the roster" description="Check your connection and refresh the page." />
        ) : !(staff ?? []).length ? (
          <EmptyState icon={ClipboardCheck} title="No staff yet" description="Staff are added under Salaries. Once added you can plan their shifts here." />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Person</Th>
                {days.map((d) => <Th key={d}>{dayLabel(d)}</Th>)}
              </Tr>
            </Thead>
            <Tbody>
              {(staff ?? []).map((s) => (
                <Tr key={s.id}>
                  <Td><div className="font-medium text-slate-900">{s.name}</div><div className="text-xs text-slate-500">{s.designation}</div></Td>
                  {days.map((d) => {
                    const r = cell.get(`${s.id}|${d}`);
                    return (
                      <Td key={d} className="whitespace-nowrap text-xs">
                        {!r ? <span className="text-slate-300">—</span> : r.dayOff ? <Badge variant="muted">Off</Badge> : (
                          <>
                            <Badge variant="info">{r.shift?.name}</Badge>
                            {r.post && <div className="mt-0.5 text-slate-500">{r.post}</div>}
                          </>
                        )}
                      </Td>
                    );
                  })}
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>

      {planning && <RosterModal open onClose={() => setPlanning(false)} defaultFrom={start} />}
    </>
  );
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function SummaryTab() {
  const [month, setMonth] = useState(monthOf(istToday()));
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery({ queryKey: ['att-summary', month], queryFn: () => staffAttendanceApi.summary(month).then((r) => r.data) });
  const detail = useQuery({ queryKey: ['att-employee', openId, month], queryFn: () => staffAttendanceApi.employeeMonth(openId!, month).then((r) => r.data), enabled: !!openId });
  const rows = data?.rows ?? [];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft size={14} /></Button>
          <input type="month" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={inputCls} />
          <Button variant="outline" size="sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"><ChevronRight size={14} /></Button>
        </div>
        <p className="text-xs text-slate-500">{data?.through ? `Counted through ${dayLabel(data.through)}. A day with nothing recorded and no day off planned is “not marked”.` : 'Nothing to count yet for this month.'}</p>
      </div>

      <Card padding="none">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : isError ? (
          <EmptyState icon={ClipboardCheck} title="Could not load the summary" description="Check your connection and refresh the page." />
        ) : !rows.length ? (
          <EmptyState icon={ClipboardCheck} title="No staff yet" description="Staff are added under Salaries." />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Person</Th><Th>Present</Th><Th>Half</Th><Th>Absent</Th><Th>Leave</Th><Th>Off</Th><Th>Not marked</Th><Th>Late</Th><Th>Days worked</Th><Th>Hours</Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((r) => (
                <Tr key={r.employeeId} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenId(r.employeeId)}>
                  <Td><div className="font-medium text-slate-900">{r.name}</div><div className="text-xs text-slate-500">{r.designation}</div></Td>
                  <Td>{r.present}</Td><Td>{r.halfDay}</Td>
                  <Td className={r.absent ? 'font-medium text-red-600' : ''}>{r.absent}</Td>
                  <Td>{r.leave}</Td><Td className="text-slate-500">{r.scheduledOff}</Td>
                  <Td className={r.unmarked ? 'text-amber-700' : ''}>{r.unmarked}</Td>
                  <Td>{r.late}</Td>
                  <Td className="font-medium">{r.daysWorked}</Td>
                  <Td className="whitespace-nowrap">{hours(r.workedMinutes)}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>

      <Modal open={!!openId} onClose={() => setOpenId(null)} title={detail.data ? `${detail.data.employee.name} · ${month}` : 'Month'}>
        {detail.isLoading ? <div className="flex justify-center py-8"><Spinner /></div> : detail.data ? (
          <div className="max-h-[60vh] space-y-1 overflow-y-auto">
            {detail.data.days.map((d) => (
              <div key={d.date} className="flex items-center justify-between gap-3 rounded-md px-2 py-1 text-sm odd:bg-slate-50">
                <span className="w-24 text-slate-700">{dayLabel(d.date)}</span>
                <span className="flex-1 text-xs text-slate-500">{d.shift ? `${d.shift.name}${d.post ? ` · ${d.post}` : ''}` : d.dayOff ? 'Day off' : ''}</span>
                <span className="text-xs text-slate-500">{d.attendance?.checkInAt ? `${fmtTime(d.attendance.checkInAt)}${d.attendance.checkOutAt ? `–${fmtTime(d.attendance.checkOutAt)}` : ''}` : ''}</span>
                {d.attendance ? <Badge variant={STATUS_VARIANT[d.attendance.status]}>{STATUS_LABEL[d.attendance.status]}{d.attendance.late ? ' · late' : ''}</Badge> : <span className="w-16 text-right text-xs text-slate-300">—</span>}
              </div>
            ))}
          </div>
        ) : null}
      </Modal>
    </>
  );
}

// ─── Shifts ──────────────────────────────────────────────────────────────────

function ShiftsTab() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useShifts();
  const [editing, setEditing] = useState<Shift | 'new' | null>(null);
  const [name, setName] = useState('');
  const [start, setStart] = useState('06:00');
  const [end, setEnd] = useState('14:00');

  const open = (s: Shift | 'new') => {
    setEditing(s);
    setName(s === 'new' ? '' : s.name);
    setStart(s === 'new' ? '06:00' : s.startTime);
    setEnd(s === 'new' ? '14:00' : s.endTime);
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ['att-shifts'] });

  const save = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), startTime: start, endTime: end };
      await (editing === 'new' ? staffAttendanceApi.createShift(body) : staffAttendanceApi.updateShift((editing as Shift).id, body));
    },
    onSuccess: () => { toast.success('Saved'); refresh(); setEditing(null); },
    onError: (e) => toast.error(errorMessage(e, 'Could not save the shift')),
  });
  const toggle = useMutation({
    mutationFn: (s: Shift) => staffAttendanceApi.updateShift(s.id, { active: !s.active }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e, 'Could not update the shift')),
  });

  return (
    <>
      <div className="flex justify-end"><Button size="sm" onClick={() => open('new')}><Plus size={14} className="mr-1" /> Add a shift</Button></div>
      <Card padding="none">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : isError ? (
          <EmptyState icon={ClipboardCheck} title="Could not load shifts" description="Check your connection and refresh the page." />
        ) : !data?.length ? (
          <EmptyState icon={ClipboardCheck} title="No shifts yet" description="Add the working periods your society uses, such as Morning 06:00–14:00, then plan who works them." action={<Button size="sm" onClick={() => open('new')}><Plus size={14} className="mr-1" /> Add a shift</Button>} />
        ) : (
          <Table>
            <Thead><Tr><Th>Shift</Th><Th>Hours (IST)</Th><Th>Status</Th><Th /></Tr></Thead>
            <Tbody>
              {data.map((s) => (
                <Tr key={s.id}>
                  <Td className="font-medium text-slate-900">{s.name}</Td>
                  <Td className="text-sm">{shiftSpan(s)}</Td>
                  <Td><Badge variant={s.active ? 'success' : 'muted'}>{s.active ? 'In use' : 'Retired'}</Badge></Td>
                  <Td className="whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" onClick={() => open(s)}>Edit</Button>
                    <Button size="sm" variant="ghost" loading={toggle.isPending && toggle.variables?.id === s.id} onClick={() => toggle.mutate(s)}>{s.active ? 'Retire' : 'Bring back'}</Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>

      <Modal open={!!editing} onClose={() => !save.isPending && setEditing(null)} title={editing === 'new' ? 'Add a shift' : 'Edit shift'}>
        <div className="space-y-4">
          <Input label="Name *" value={name} maxLength={40} placeholder="Morning" onChange={(e) => setName(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Starts" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            <Input label="Ends" type="time" value={end} onChange={(e) => setEnd(e.target.value)} hint="Earlier than the start runs past midnight" />
          </div>
          <p className="text-xs text-slate-500">A shift in use cannot be deleted, only retired, so past days keep their meaning.</p>
          <div className="flex justify-end gap-3">
            <Button variant="outline" disabled={save.isPending} onClick={() => setEditing(null)}>Cancel</Button>
            <Button loading={save.isPending} disabled={name.trim().length < 2 || !start || !end || start === end} onClick={() => save.mutate()}>Save</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export default function StaffAttendancePage() {
  const [tab, setTab] = useState<Tab>('day');
  const tabs: [Tab, string][] = [['day', 'Day'], ['roster', 'Roster'], ['summary', 'Summary'], ['shifts', 'Shifts']];
  return (
    <>
      <Header title="Staff attendance" subtitle="Shifts, duty roster and who came when" />
      <PageContainer className="space-y-4">
        <div role="tablist" className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
          {tabs.map(([t, label]) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${tab === t ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'day' ? <DayTab /> : tab === 'roster' ? <RosterTab /> : tab === 'summary' ? <SummaryTab /> : <ShiftsTab />}
      </PageContainer>
    </>
  );
}
