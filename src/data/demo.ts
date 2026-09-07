import type { CorrectiveAction, Inspection } from '../types';

export const demoInspections: Inspection[] = [
  {
    id: 'inspection-1',
    title: 'Underground ventilation inspection',
    mine: 'Dhanbad Central Mine',
    inspector: 'Priya Sharma',
    status: 'in_progress',
    dueDate: '2026-02-28',
    severity: 'high',
  },
  {
    id: 'inspection-2',
    title: 'Haul road safety checklist',
    mine: 'Singrauli East Mine',
    inspector: 'Arjun Kumar',
    status: 'scheduled',
    dueDate: '2026-03-05',
    severity: 'medium',
  },
];

export const demoActions: CorrectiveAction[] = [
  {
    id: 'action-1',
    title: 'Repair emergency stop signage',
    owner: 'Ravi Mehta',
    status: 'open',
    dueDate: '2026-02-24',
    severity: 'critical',
  },
  {
    id: 'action-2',
    title: 'Update methane detector calibration log',
    owner: 'Neha Singh',
    status: 'in_progress',
    dueDate: '2026-03-01',
    severity: 'high',
  },
];
