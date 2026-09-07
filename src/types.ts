export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type UserRole =
  | 'administrator'
  | 'mine_manager'
  | 'inspector'
  | 'regulatory_authority'
  | 'corporate_management'
  | 'corrective_action_owner'
  | 'verifier_approver';

export type UserProfile = {
  id: string;
  fullName: string;
  role: UserRole;
  organizationId: string | null;
  mineId: string | null;
};

export type Department = {
  id: string;
  mineId: string;
  name: string;
  code: string | null;
  ownerId: string | null;
  status: 'active' | 'archived';
};

export type ComplianceRequirement = {
  id: string;
  organizationId: string;
  subsidiaryId: string | null;
  mineId: string | null;
  departmentId: string | null;
  title: string;
  description: string;
  sourceReference: string | null;
  responsibleUserId: string | null;
  responsibleRole: string | null;
  frequency: 'one_time' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'custom';
  dueDate: string;
  nextDueDate: string | null;
  evidenceType: string | null;
  severity: RiskLevel;
  status: 'pending' | 'due_soon' | 'overdue' | 'completed' | 'critical';
};

export type Inspection = {
  id: string;
  title: string;
  mine: string;
  inspector: string;
  status: 'scheduled' | 'in_progress' | 'paused' | 'completed';
  dueDate: string;
  severity: RiskLevel;
  frequency?: string;
  evidenceType?: string;
  notes?: string;
  syncState?: 'local' | 'queued' | 'synced' | 'failed' | 'conflict';
  startedAt?: string | null;
  submittedAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  templateId?: string | null;
  templateVersionId?: string | null;
};

export type InspectionResponseType = 'pass' | 'fail' | 'not_applicable' | 'numeric' | 'text' | 'selection';

export type InspectionQuestion = {
  key: string;
  prompt: string;
  responseType: InspectionResponseType;
  guidance: string;
  evidenceRequired: boolean;
  severityDefault: RiskLevel;
};

export type InspectionSection = {
  key: string;
  title: string;
  guidance: string;
  questions: InspectionQuestion[];
};

export type InspectionTemplate = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  applicableDepartmentId: string | null;
  status: 'active' | 'archived';
  versionId: string | null;
  versionNumber: number | null;
  versionStatus: 'draft' | 'published' | 'retired' | null;
  sections: InspectionSection[];
};

export type CorrectiveAction = {
  id: string;
  actionNumber?: number | null;
  description?: string;
  observationId?: string | null;
  verifierId?: string | null;
  title: string;
  owner: string;
  status: 'open' | 'assigned' | 'in_progress' | 'resolved' | 'verified' | 'closed';
  dueDate: string;
  severity: RiskLevel;
  expectedResolution?: string;
  progressNotes?: string | null;
  resolutionEvidenceCount?: number;
  verificationDecision?: 'approved' | 'rejected' | 'changes_requested' | null;
  verificationNotes?: string | null;
  reopenReason?: string | null;
};

export type ObservationStatus = 'open' | 'assigned' | 'in_progress' | 'resolved' | 'verified' | 'closed';

export type Observation = {
  id: string;
  observationNumber: number | null;
  inspectionId: string | null;
  organizationId: string;
  mineId: string;
  departmentId: string | null;
  description: string;
  category: string;
  severity: RiskLevel;
  status: ObservationStatus;
  inspectorId: string | null;
  ownerId: string | null;
  observedAt: string;
  latitude: number | null;
  longitude: number | null;
  locationDescription: string | null;
  immediateContainment: string | null;
  containmentRequired: boolean;
  correctiveActionId: string | null;
};

export type ObservationHistory = {
  id: string;
  observationId: string;
  actorId: string | null;
  action: string;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  createdAt: string;
};

export type MineRiskAssessment = {
  score: number;
  level: RiskLevel;
  contributingFactors: Array<{ key: string; value: number; weight: number; points: number }>;
  comparisonStart: string;
  comparisonEnd: string;
  dataSufficient: boolean;
  recommendedAttention: string;
  modelVersion: string;
};

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  sourceType: string;
  sourceId: string;
  notificationType: string;
  status: 'pending' | 'sent' | 'failed' | 'acknowledged';
  createdAt: string;
  acknowledgedAt: string | null;
};
