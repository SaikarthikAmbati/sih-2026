import React, { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { computeMineRiskAssessment, computeRiskScore } from './riskEngine.js';
import { demoActions, demoInspections } from './src/data/demo';
import { requestGeminiInsight } from './src/lib/gemini';
import { acknowledgeNotification, archiveDepartment, isSupabaseConfigured, loadComplianceRequirements, loadCorrectiveActions, loadDepartments, loadInspectionTemplates, loadNotifications, loadObservationHistory, loadObservations, loadUserProfile, saveComplianceRequirement, saveDepartment, saveInspectionTemplate, saveInspectionWorkflow, saveObservation, supabase, transitionCorrectiveAction } from './src/lib/supabase';
import type { AppNotification, ComplianceRequirement, CorrectiveAction, Department, Inspection, InspectionQuestion, InspectionResponseType, InspectionSection, InspectionTemplate, Observation, ObservationHistory, RiskLevel, UserProfile, UserRole } from './src/types';

type Screen = 'dashboard' | 'inspections' | 'actions' | 'new-inspection' | 'departments' | 'requirements' | 'templates' | 'observations' | 'notifications';

const roleLabels: Record<UserRole, string> = {
  administrator: 'Administrator',
  mine_manager: 'Mine Manager',
  inspector: 'Inspector',
  regulatory_authority: 'Regulatory Authority',
  corporate_management: 'Corporate Management',
  corrective_action_owner: 'Corrective-Action Owner',
  verifier_approver: 'Verifier / Approver',
};

const roleDashboardCopy: Record<UserRole, { title: string; subtitle: string; focus: string }> = {
  administrator: { title: 'Organization control center', subtitle: 'All authorized mines · administration', focus: 'Organization-wide compliance' },
  mine_manager: { title: 'Mine operations', subtitle: 'Assigned mine(s) · field execution', focus: 'Mine performance and deadlines' },
  inspector: { title: 'My inspections', subtitle: 'Assigned mines · your submissions', focus: 'Inspections, observations and evidence' },
  regulatory_authority: { title: 'Portfolio compliance', subtitle: 'Authorized regulatory portfolio · read-only', focus: 'Compliance, violations and escalations' },
  corporate_management: { title: 'Enterprise risk', subtitle: 'Organization-wide · read-only operations', focus: 'Cross-mine trends and risk' },
  corrective_action_owner: { title: 'My corrective actions', subtitle: 'Actions assigned to you', focus: 'Progress, evidence and verification requests' },
  verifier_approver: { title: 'Verification queue', subtitle: 'Actions assigned to you for approval', focus: 'Verification decisions and closure' },
};

function canViewInspections(role: UserRole) {
  return role !== 'corrective_action_owner' && role !== 'verifier_approver';
}

function canViewActions(role: UserRole) {
  return role !== 'inspector';
}

function canCreateInspection(role: UserRole) {
  return role === 'administrator' || role === 'mine_manager' || role === 'inspector';
}

function canManageDepartments(role: UserRole) {
  return role === 'administrator' || role === 'mine_manager';
}

function canManageRequirements(role: UserRole) {
  return role === 'administrator';
}

function canManageTemplates(role: UserRole) {
  return role === 'administrator';
}

function canManageObservations(role: UserRole) {
  return role === 'administrator' || role === 'mine_manager' || role === 'inspector';
}

function canVerifyActions(role: UserRole) {
  return role === 'administrator' || role === 'mine_manager' || role === 'verifier_approver';
}

function canViewCompliance(_role: UserRole) {
  return true;
}

const colors = {
  ink: '#102A27',
  muted: '#647773',
  paper: '#F5F8F5',
  card: '#FFFFFF',
  accent: '#0E7C66',
  accentSoft: '#D9F0E9',
  warning: '#D9822B',
  danger: '#B94242',
  line: '#DCE6E2',
};

function riskColor(level: RiskLevel) {
  return level === 'critical' || level === 'high' ? colors.danger : level === 'medium' ? colors.warning : colors.accent;
}

function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${riskColor(level)}18` }]}>
      <Text style={[styles.badgeText, { color: riskColor(level) }]}>{level.toUpperCase()}</Text>
    </View>
  );
}

function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.eyebrow}>MINEPULSE</Text>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <View style={styles.statusDot} />
    </View>
  );
}

type RoleDashboardProps = {
  profile: UserProfile;
  inspections: Inspection[];
  actions: CorrectiveAction[];
  onNavigate: (screen: Screen) => void;
  departments: Department[];
  requirements: ComplianceRequirement[];
};

function ResponsibilityCard({ title, items }: { title: string; items: string[] }) {
  return (
    <View style={styles.responsibilityCard}>
      <Text style={styles.responsibilityTitle}>{title}</Text>
      {items.map((item) => <Text style={styles.responsibilityItem} key={item}>• {item}</Text>)}
    </View>
  );
}

function DepartmentManagement({
  profile,
  departments,
  onChange,
  onBack,
}: {
  profile: UserProfile;
  departments: Department[];
  onChange: (department: Department) => void;
  onBack: () => void;
}) {
  const [editing, setEditing] = useState<Department | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [mineId, setMineId] = useState(profile.mineId ?? '');
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const visibleDepartments = departments.filter((department) => department.status === 'active');

  const beginEdit = (department?: Department) => {
    setEditing(department ?? null);
    setFormOpen(true);
    setName(department?.name ?? '');
    setCode(department?.code ?? '');
    setOwnerId(department?.ownerId ?? '');
    setMineId(department?.mineId ?? profile.mineId ?? '');
  };

  const submit = async () => {
    if (!name.trim()) return Alert.alert('Name required', 'Enter a department name.');
    if (!mineId.trim()) return Alert.alert('Mine required', 'Enter the authorized mine ID for this department.');
    setBusy(true);
    try {
      const department = await saveDepartment({
        id: editing?.id ?? '',
        mineId,
        name,
        code,
        ownerId,
      });
      onChange(department);
      setEditing(null);
      setFormOpen(false);
      setName('');
      setCode('');
      setOwnerId('');
      setMineId('');
    } catch (error) {
      Alert.alert('Unable to save department', error instanceof Error ? error.message : 'Try again later.');
    } finally {
      setBusy(false);
    }
  };

  const archive = (department: Department) => {
    Alert.alert('Archive department?', `${department.name} will no longer be available for routing.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        style: 'destructive',
        onPress: async () => {
          try {
            await archiveDepartment(department.id);
            onChange({ ...department, status: 'archived' });
          } catch (error) {
            Alert.alert('Unable to archive department', error instanceof Error ? error.message : 'Try again later.');
          }
        },
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.inlineHeader}>
        <TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ Back</Text></TouchableOpacity>
        <Text style={styles.screenTitle}>Departments</Text>
        <TouchableOpacity onPress={() => beginEdit()}><Text style={styles.add}>＋</Text></TouchableOpacity>
      </View>
      <Text style={styles.sectionHint}>Manage safety, electrical, operations, environment, equipment, HR, and customer-defined groups.</Text>
      {visibleDepartments.map((department) => (
        <View style={styles.listCard} key={department.id}>
          <Text style={styles.cardTitle}>{department.name}</Text>
          <Text style={styles.cardMeta}>{department.code || 'No code'} · Owner: {department.ownerId || 'Unassigned'}</Text>
          <View style={styles.departmentActions}>
            <TouchableOpacity onPress={() => beginEdit(department)}><Text style={styles.back}>Edit</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => archive(department)}><Text style={styles.archiveText}>Archive</Text></TouchableOpacity>
          </View>
        </View>
      ))}
      {formOpen ? (
        <View style={styles.formCard}>
          <Text style={styles.responsibilityTitle}>{editing ? 'Edit department' : 'New department'}</Text>
          <Text style={styles.fieldLabel}>Department name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Safety" placeholderTextColor={colors.muted} />
          <Text style={styles.fieldLabel}>Code</Text>
          <TextInput style={styles.input} value={code} onChangeText={setCode} placeholder="e.g. SAF" placeholderTextColor={colors.muted} autoCapitalize="characters" />
          <Text style={styles.fieldLabel}>Owner user ID</Text>
          <TextInput style={styles.input} value={ownerId} onChangeText={setOwnerId} placeholder="Optional auth user ID" placeholderTextColor={colors.muted} autoCapitalize="none" />
          <Text style={styles.fieldLabel}>Mine ID</Text>
          <TextInput style={styles.input} value={mineId} onChangeText={setMineId} placeholder="Authorized mine UUID" placeholderTextColor={colors.muted} autoCapitalize="none" />
          <TouchableOpacity style={styles.primaryButton} onPress={submit} disabled={busy}><Text style={styles.primaryButtonText}>{busy ? 'Saving…' : 'Save department'}</Text></TouchableOpacity>
        </View>
      ) : null}
    </ScrollView>
  );
}

function ComplianceRequirementManagement({ profile, requirements, onChange, onBack }: { profile: UserProfile; requirements: ComplianceRequirement[]; onChange: (requirement: ComplianceRequirement) => void; onBack: () => void }) {
  const canEdit = canManageRequirements(profile.role);
  const [editing, setEditing] = useState<ComplianceRequirement | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scopeType, setScopeType] = useState<'organization' | 'subsidiary' | 'mine' | 'department'>('organization');
  const [scopeId, setScopeId] = useState(profile.organizationId ?? '');
  const [responsible, setResponsible] = useState('');
  const [frequency, setFrequency] = useState<ComplianceRequirement['frequency']>('monthly');
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState('');
  const [evidenceType, setEvidenceType] = useState('');
  const [severity, setSeverity] = useState<RiskLevel>('medium');
  const [status, setStatus] = useState<ComplianceRequirement['status']>('pending');
  const [busy, setBusy] = useState(false);
  const edit = (item?: ComplianceRequirement) => {
    setEditing(item ?? null); setOpen(true); setTitle(item?.title ?? ''); setDescription(item?.description ?? '');
    setScopeType(item?.departmentId ? 'department' : item?.mineId ? 'mine' : item?.subsidiaryId ? 'subsidiary' : 'organization'); setScopeId(item?.organizationId ?? item?.mineId ?? item?.departmentId ?? item?.subsidiaryId ?? ''); setResponsible(item?.responsibleRole ?? item?.responsibleUserId ?? '');
    setFrequency(item?.frequency ?? 'monthly'); setDueDate(item?.dueDate ?? new Date().toISOString().slice(0, 10)); setSource(item?.sourceReference ?? '');
    setEvidenceType(item?.evidenceType ?? ''); setSeverity(item?.severity ?? 'medium'); setStatus(item?.status ?? 'pending');
  };
  const submit = async () => {
    if (!profile.organizationId || !title.trim() || !description.trim() || !scopeId.trim() || !responsible.trim() || !dueDate.trim()) return Alert.alert('Required fields missing', 'Complete title, description, scope, responsible role/user, and due date.');
    setBusy(true);
    try {
      const item = await saveComplianceRequirement({ id: editing?.id, organizationId: profile.organizationId, subsidiaryId: scopeType === 'subsidiary' ? scopeId : null, mineId: scopeType === 'mine' ? scopeId : null, departmentId: scopeType === 'department' ? scopeId : null, title, description, sourceReference: source, responsibleRole: responsible, responsibleUserId: null, frequency, dueDate, nextDueDate: null, evidenceType, severity });
      onChange({ ...item, status }); setOpen(false);
    } catch (error) { Alert.alert('Unable to save requirement', error instanceof Error ? error.message : 'Try again later.'); } finally { setBusy(false); }
  };
  const statusCounts = requirements.reduce<Record<ComplianceRequirement['status'], number>>((counts, item) => ({ ...counts, [item.status]: counts[item.status] + 1 }), { pending: 0, due_soon: 0, overdue: 0, completed: 0, critical: 0 });
  return <ScrollView contentContainerStyle={styles.content}><View style={styles.inlineHeader}><TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ Back</Text></TouchableOpacity><Text style={styles.screenTitle}>Compliance dashboard</Text>{canEdit ? <TouchableOpacity onPress={() => edit()}><Text style={styles.add}>＋</Text></TouchableOpacity> : <View style={{ width: 30 }} />}</View>
    <View style={styles.statusGrid}>{(['pending', 'due_soon', 'overdue', 'completed', 'critical'] as ComplianceRequirement['status'][]).map((item) => <View style={styles.statusCard} key={item}><Text style={styles.statusValue}>{statusCounts[item]}</Text><Text style={styles.statusLabel}>{item.replace('_', ' ')}</Text></View>)}</View>
    {requirements.map((item) => <View style={styles.listCard} key={item.id}><View style={styles.cardTop}><Text style={styles.cardTitle}>{item.title}</Text><RiskBadge level={item.severity} /></View><Text style={styles.cardMeta}>{item.status.replace('_', ' ')} · Due {item.dueDate} · {item.frequency.replace('_', ' ')}</Text><Text style={styles.cardMeta}>{item.sourceReference || 'Internal'} · {item.responsibleRole || item.responsibleUserId}</Text>{canEdit ? <TouchableOpacity onPress={() => edit(item)}><Text style={styles.back}>Edit</Text></TouchableOpacity> : null}</View>)}
    {open ? <View style={styles.formCard}><Text style={styles.responsibilityTitle}>{editing ? 'Edit requirement' : 'New requirement'}</Text><Text style={styles.fieldLabel}>Title *</Text><TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Compliance obligation" placeholderTextColor={colors.muted} /><Text style={styles.fieldLabel}>Description *</Text><TextInput style={[styles.input, styles.multilineInput]} value={description} onChangeText={setDescription} multiline placeholder="What must be done" placeholderTextColor={colors.muted} /><Text style={styles.fieldLabel}>Applicable scope *</Text><View style={styles.choiceRow}>{(['organization', 'subsidiary', 'mine', 'department'] as const).map((choice) => <TouchableOpacity key={choice} style={[styles.choice, scopeType === choice && styles.choiceSelected]} onPress={() => setScopeType(choice)}><Text style={styles.choiceText}>{choice}</Text></TouchableOpacity>)}</View><TextInput style={styles.input} value={scopeId} onChangeText={setScopeId} placeholder="Scope UUID" placeholderTextColor={colors.muted} autoCapitalize="none" /><Text style={styles.fieldLabel}>Source / responsible role or user *</Text><TextInput style={styles.input} value={source} onChangeText={setSource} placeholder="Regulation, permit, policy..." placeholderTextColor={colors.muted} /><TextInput style={styles.input} value={responsible} onChangeText={setResponsible} placeholder="Accountable role or user ID" placeholderTextColor={colors.muted} /><Text style={styles.fieldLabel}>Frequency / due date *</Text><TextInput style={styles.input} value={frequency} onChangeText={(value) => setFrequency(value as ComplianceRequirement['frequency'])} placeholder="monthly" placeholderTextColor={colors.muted} /><TextInput style={styles.input} value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} /><Text style={styles.fieldLabel}>Evidence type / severity / status</Text><TextInput style={styles.input} value={evidenceType} onChangeText={setEvidenceType} placeholder="Inspection, photo, document..." placeholderTextColor={colors.muted} /><TextInput style={styles.input} value={severity} onChangeText={(value) => setSeverity(value as RiskLevel)} placeholder="low, medium, high, critical" placeholderTextColor={colors.muted} /><TextInput style={styles.input} value={status} onChangeText={(value) => setStatus(value as ComplianceRequirement['status'])} placeholder="pending, due_soon, overdue..." placeholderTextColor={colors.muted} /><TouchableOpacity style={styles.primaryButton} onPress={submit} disabled={busy}><Text style={styles.primaryButtonText}>{busy ? 'Saving…' : 'Save requirement'}</Text></TouchableOpacity></View> : null}</ScrollView>;
}

function InspectionTemplateManagement({ profile, templates, onChange, onBack }: { profile: UserProfile; templates: InspectionTemplate[]; onChange: (template: InspectionTemplate) => void; onBack: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [sections, setSections] = useState<InspectionSection[]>([]);
  const [sectionTitle, setSectionTitle] = useState('');
  const [questionPrompt, setQuestionPrompt] = useState('');
  const [questionType, setQuestionType] = useState<InspectionResponseType>('pass');
  const [guidance, setGuidance] = useState('');
  const [evidenceRequired, setEvidenceRequired] = useState(false);
  const [severity, setSeverity] = useState<RiskLevel>('medium');
  const [busy, setBusy] = useState(false);
  const addQuestion = () => {
    if (!sectionTitle.trim() || !questionPrompt.trim()) return Alert.alert('Question required', 'Enter a section title and checklist question.');
    const sectionKey = sectionTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const question: InspectionQuestion = { key: `${sectionKey}_${Date.now()}`, prompt: questionPrompt.trim(), responseType: questionType, guidance: guidance.trim(), evidenceRequired, severityDefault: severity };
    const existing = sections.find((item) => item.key === sectionKey);
    setSections(existing ? sections.map((item) => item.key === sectionKey ? { ...item, questions: [...item.questions, question] } : item) : [...sections, { key: sectionKey, title: sectionTitle.trim(), guidance: '', questions: [question] }]);
    setQuestionPrompt(''); setGuidance(''); setEvidenceRequired(false);
  };
  const edit = (template: InspectionTemplate) => {
    setName(template.name); setDescription(template.description ?? ''); setDepartmentId(template.applicableDepartmentId ?? ''); setSections(template.sections);
  };
  const submit = async () => {
    if (!profile.organizationId || !name.trim() || sections.length === 0) return Alert.alert('Required fields missing', 'Enter a template name and add at least one checklist question.');
    setBusy(true);
    try {
      const saved = await saveInspectionTemplate({ organizationId: profile.organizationId, userId: profile.id, name, description, applicableDepartmentId: departmentId || null, sections });
      onChange(saved); setName(''); setDescription(''); setDepartmentId(''); setSections([]);
      Alert.alert('Template published', `Version ${saved.versionNumber} is now available for new inspections.`);
    } catch (error) { Alert.alert('Unable to save template', error instanceof Error ? error.message : 'Try again later.'); } finally { setBusy(false); }
  };
  return <ScrollView contentContainerStyle={styles.content}><View style={styles.inlineHeader}><TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ Back</Text></TouchableOpacity><Text style={styles.screenTitle}>Inspection templates</Text><View style={{ width: 30 }} /></View><Text style={styles.cardMeta}>Published versions are immutable and are retained on submitted inspections.</Text>{templates.map((template) => <View style={styles.listCard} key={template.id}><Text style={styles.cardTitle}>{template.name} · v{template.versionNumber ?? '?'}</Text><Text style={styles.cardMeta}>{template.sections.length} sections · {template.sections.reduce((count, section) => count + section.questions.length, 0)} questions</Text><TouchableOpacity onPress={() => edit(template)}><Text style={styles.back}>Create next version from this template</Text></TouchableOpacity></View>)}<View style={styles.formCard}><Text style={styles.responsibilityTitle}>Publish template version</Text><TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Template name *" placeholderTextColor={colors.muted} /><TextInput style={[styles.input, styles.multilineInput]} value={description} onChangeText={setDescription} multiline placeholder="Description and usage guidance" placeholderTextColor={colors.muted} /><TextInput style={styles.input} value={departmentId} onChangeText={setDepartmentId} placeholder="Applicable department UUID (optional)" placeholderTextColor={colors.muted} autoCapitalize="none" /><Text style={styles.fieldLabel}>Checklist question</Text><TextInput style={styles.input} value={sectionTitle} onChangeText={setSectionTitle} placeholder="Section title, e.g. PPE" placeholderTextColor={colors.muted} /><TextInput style={styles.input} value={questionPrompt} onChangeText={setQuestionPrompt} placeholder="Question or checklist instruction" placeholderTextColor={colors.muted} /><TextInput style={styles.input} value={questionType} onChangeText={(value) => setQuestionType(value as InspectionResponseType)} placeholder="pass, fail, numeric, text, selection..." placeholderTextColor={colors.muted} /><TextInput style={[styles.input, styles.multilineInput]} value={guidance} onChangeText={setGuidance} multiline placeholder="Guidance for the inspector" placeholderTextColor={colors.muted} /><TextInput style={styles.input} value={severity} onChangeText={(value) => setSeverity(value as RiskLevel)} placeholder="Default severity" placeholderTextColor={colors.muted} /><TouchableOpacity style={styles.secondaryButton} onPress={() => setEvidenceRequired((value) => !value)}><Text style={styles.secondaryButtonText}>{evidenceRequired ? 'Evidence required: yes' : 'Evidence required: no'}</Text></TouchableOpacity><TouchableOpacity style={styles.secondaryButton} onPress={addQuestion}><Text style={styles.secondaryButtonText}>Add checklist question ({sections.reduce((count, section) => count + section.questions.length, 0)})</Text></TouchableOpacity><TouchableOpacity style={styles.primaryButton} onPress={() => void submit()} disabled={busy}><Text style={styles.primaryButtonText}>{busy ? 'Publishing…' : 'Publish new version'}</Text></TouchableOpacity></View></ScrollView>;
}

function ObservationManagement({ profile, observations, onChange, onBack }: { profile: UserProfile; observations: Observation[]; onChange: (observation: Observation) => void; onBack: () => void }) {
  const [selected, setSelected] = useState<Observation | null>(null);
  const [history, setHistory] = useState<ObservationHistory[]>([]);
  const [severityFilter, setSeverityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('safety');
  const [mineId, setMineId] = useState(profile.mineId ?? '');
  const [containment, setContainment] = useState('');
  const [severity, setSeverity] = useState<RiskLevel>('medium');
  const [busy, setBusy] = useState(false);
  const visible = observations.filter((item) => (!severityFilter || item.severity === severityFilter) && (!statusFilter || item.status === statusFilter));
  const openDetail = async (item: Observation) => {
    setSelected(item);
    try { setHistory(await loadObservationHistory(item.id)); } catch (error) { Alert.alert('Unable to load history', error instanceof Error ? error.message : 'Try again later.'); }
  };
  const submit = async () => {
    if (!profile.organizationId || !mineId.trim() || !description.trim() || !category.trim()) return Alert.alert('Required fields missing', 'Enter mine, category, and issue description.');
    if (severity === 'critical' && !containment.trim()) return Alert.alert('Containment required', 'Critical observations require immediate containment before submission.');
    setBusy(true);
    try {
      const saved = await saveObservation({ organizationId: profile.organizationId, mineId, departmentId: null, description, category, severity, status: 'open', inspectorId: profile.id, ownerId: null, latitude: null, longitude: null, locationDescription: null, immediateContainment: containment, containmentRequired: severity === 'critical' });
      onChange(saved); setDescription(''); setContainment(''); setSeverity('medium'); Alert.alert('Observation recorded', severity === 'critical' ? 'Safety leadership and mine management were escalated.' : 'The finding is now traceable to remediation.');
    } catch (error) {
      const databaseError = error as { message?: string; code?: string; details?: string; hint?: string };
      const detail = [databaseError.code, databaseError.message, databaseError.details, databaseError.hint].filter(Boolean).join('\n');
      Alert.alert('Unable to save observation', detail || 'The database rejected the record. Check your mine scope and required migration columns.');
    } finally { setBusy(false); }
  };
  return <ScrollView contentContainerStyle={styles.content}><View style={styles.inlineHeader}><TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ Back</Text></TouchableOpacity><Text style={styles.screenTitle}>Observations</Text><View style={{ width: 30 }} /></View><Text style={styles.cardMeta}>Findings are scoped by Supabase RLS and retain an append-only change history.</Text><View style={styles.choiceRow}>{['', 'low', 'medium', 'high', 'critical'].map((item) => <TouchableOpacity key={item || 'all-severity'} style={[styles.choice, severityFilter === item && styles.choiceSelected]} onPress={() => setSeverityFilter(item)}><Text style={styles.choiceText}>{item || 'all severity'}</Text></TouchableOpacity>)}</View><View style={styles.choiceRow}>{['', 'open', 'assigned', 'in_progress', 'resolved', 'verified', 'closed'].map((item) => <TouchableOpacity key={item || 'all-status'} style={[styles.choice, statusFilter === item && styles.choiceSelected]} onPress={() => setStatusFilter(item)}><Text style={styles.choiceText}>{item || 'all status'}</Text></TouchableOpacity>)}</View>{visible.map((item) => <TouchableOpacity style={styles.listCard} key={item.id} onPress={() => void openDetail(item)}><View style={styles.cardTop}><RiskBadge level={item.severity} /><Text style={styles.due}>{item.status.replace('_', ' ')}</Text></View><Text style={styles.cardTitle}>#{item.observationNumber ?? 'draft'} · {item.description}</Text><Text style={styles.cardMeta}>{item.category} · Mine {item.mineId} · {new Date(item.observedAt).toLocaleString()}</Text></TouchableOpacity>)}{canManageObservations(profile.role) ? <View style={styles.formCard}><Text style={styles.responsibilityTitle}>Record observation</Text><TextInput style={styles.input} value={mineId} onChangeText={setMineId} placeholder="Mine UUID *" placeholderTextColor={colors.muted} autoCapitalize="none" /><TextInput style={styles.input} value={category} onChangeText={setCategory} placeholder="Category: safety, electrical..." placeholderTextColor={colors.muted} /><TextInput style={[styles.input, styles.multilineInput]} value={description} onChangeText={setDescription} multiline placeholder="Issue description *" placeholderTextColor={colors.muted} /><TextInput style={styles.input} value={severity} onChangeText={(value) => setSeverity(value as RiskLevel)} placeholder="low, medium, high, critical" placeholderTextColor={colors.muted} /><TextInput style={[styles.input, styles.multilineInput]} value={containment} onChangeText={setContainment} multiline placeholder="Immediate containment (required for critical)" placeholderTextColor={colors.muted} /><TouchableOpacity style={styles.primaryButton} onPress={() => void submit()} disabled={busy}><Text style={styles.primaryButtonText}>{busy ? 'Saving…' : 'Record finding'}</Text></TouchableOpacity></View> : null}{selected ? <View style={styles.formCard}><Text style={styles.responsibilityTitle}>Observation history</Text><Text style={styles.cardMeta}>{selected.description}</Text>{history.map((entry) => <Text style={styles.cardMeta} key={entry.id}>{new Date(entry.createdAt).toLocaleString()} · {entry.action}</Text>)}<TouchableOpacity onPress={() => setSelected(null)}><Text style={styles.back}>Close detail</Text></TouchableOpacity></View> : null}</ScrollView>;
}

function NotificationCenter({ notifications, onAcknowledge, onBack }: { notifications: AppNotification[]; onAcknowledge: (notification: AppNotification) => void; onBack: () => void }) {
  return <View style={styles.screen}><View style={styles.inlineHeader}><TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ Back</Text></TouchableOpacity><Text style={styles.screenTitle}>Notifications</Text><View style={{ width: 30 }} /></View><FlatList contentContainerStyle={styles.content} data={notifications} keyExtractor={(item) => item.id} ListEmptyComponent={<Text style={styles.connection}>No notifications.</Text>} renderItem={({ item }) => <View style={styles.listCard}><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardMeta}>{item.body}</Text><Text style={styles.cardMeta}>{item.notificationType.replace('_', ' ')} · {new Date(item.createdAt).toLocaleString()}</Text>{item.status !== 'acknowledged' ? <TouchableOpacity onPress={() => onAcknowledge(item)}><Text style={styles.back}>Acknowledge</Text></TouchableOpacity> : <Text style={styles.cardMeta}>Acknowledged</Text>}</View>} /></View>;
}

function AdministratorDashboard(props: RoleDashboardProps) {
  return <RoleDashboardFrame {...props} title="Organization control center" subtitle="Governance and platform administration" responsibilities={['Manage users, roles, organizations and mines', 'Configure departments, templates and settings', 'Review audit access and organization-wide compliance']} />;
}

function MineManagerDashboard(props: RoleDashboardProps) {
  return <RoleDashboardFrame {...props} title="Mine operations" subtitle="Operational compliance for assigned mine(s)" responsibilities={['Review inspections and mine dashboards', 'Assign corrective actions and manage deadlines', 'Approve closure where explicitly authorized']} />;
}

function InspectorDashboard(props: RoleDashboardProps) {
  return <RoleDashboardFrame {...props} title="My inspections" subtitle="Field inspections and evidence capture" responsibilities={['Start inspections for assigned mines', 'Create observations and capture media, GPS and timestamps', 'Submit reports and update permitted records']} />;
}

function RegulatoryAuthorityDashboard(props: RoleDashboardProps) {
  return <RoleDashboardFrame {...props} title="Portfolio compliance" subtitle="Authorized portfolio · read-only unless explicitly enabled" responsibilities={['Monitor compliance, violations, evidence and risk', 'Review corrective actions, escalations and reports', 'Editing remains disabled unless an administrator enables it']} />;
}

function CorporateManagementDashboard(props: RoleDashboardProps) {
  return <RoleDashboardFrame {...props} title="Enterprise risk" subtitle="Cross-mine and subsidiary oversight" responsibilities={['Compare cross-mine trends and dashboards', 'Review organization-wide risk', 'Export reports and receive escalations']} />;
}

function CorrectiveActionOwnerDashboard(props: RoleDashboardProps) {
  return <RoleDashboardFrame {...props} title="My corrective actions" subtitle="Findings assigned to you" responsibilities={['Submit progress and respond to comments', 'Upload resolution evidence', 'Request verification when work is complete']} />;
}

function VerifierApproverDashboard(props: RoleDashboardProps) {
  return <RoleDashboardFrame {...props} title="Verification queue" subtitle="Resolution review and closure decisions" responsibilities={['Review corrective-action evidence', 'Approve or reject resolution with notes', 'Close or reopen actions assigned for verification']} />;
}

function RoleDashboardFrame({
  profile,
  inspections,
  actions,
  departments,
  requirements,
  onNavigate,
  title,
  subtitle,
  responsibilities,
}: RoleDashboardProps & { title: string; subtitle: string; responsibilities: string[] }) {
  const canInspect = canViewInspections(profile.role);
  const canActions = canViewActions(profile.role);
  return (
    <>
      <Header title={title} subtitle={`${profile.fullName} · ${subtitle}`} />
      <View style={styles.roleBanner}>
        <Text style={styles.roleText}>{roleLabels[profile.role]}</Text>
        <Text style={styles.roleFocus}>{roleDashboardCopy[profile.role].focus}</Text>
      </View>
      <ResponsibilityCard title="Your workspace" items={responsibilities} />
      {canManageDepartments(profile.role) ? <TouchableOpacity style={styles.secondaryButton} onPress={() => onNavigate('departments')}><Text style={styles.secondaryButtonText}>Manage departments ({departments.length})</Text></TouchableOpacity> : null}
      {canManageTemplates(profile.role) ? <TouchableOpacity style={styles.secondaryButton} onPress={() => onNavigate('templates')}><Text style={styles.secondaryButtonText}>Manage inspection templates</Text></TouchableOpacity> : null}
      <TouchableOpacity style={styles.secondaryButton} onPress={() => onNavigate('observations')}><Text style={styles.secondaryButtonText}>Observation management</Text></TouchableOpacity>
      {canViewCompliance(profile.role) ? <TouchableOpacity style={styles.secondaryButton} onPress={() => onNavigate('requirements')}><Text style={styles.secondaryButtonText}>Compliance dashboard ({requirements.length})</Text></TouchableOpacity> : null}
      <View style={styles.statsRow}>
        {canInspect ? <TouchableOpacity style={styles.statCard} onPress={() => onNavigate('inspections')}>
          <Text style={styles.statValue}>{inspections.length}</Text><Text style={styles.statLabel}>Visible inspections</Text>
        </TouchableOpacity> : null}
        {canActions ? <TouchableOpacity style={styles.statCard} onPress={() => onNavigate('actions')}>
          <Text style={[styles.statValue, { color: colors.danger }]}>{actions.length}</Text><Text style={styles.statLabel}>Visible actions</Text>
        </TouchableOpacity> : null}
      </View>
      {canActions ? <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Priority attention</Text><Text style={styles.sectionHint}>Authorized data only</Text></View> : null}
      {canActions ? actions.map((action) => (
        <View style={styles.listCard} key={action.id}>
          <View style={styles.cardTop}><RiskBadge level={action.severity} /><Text style={styles.due}>{action.dueDate}</Text></View>
          <Text style={styles.cardTitle}>{action.title}</Text><Text style={styles.cardMeta}>Owner: {action.owner} · {action.status.replace('_', ' ')}</Text>
        </View>
      )) : null}
    </>
  );
}

function RoleDashboard(props: RoleDashboardProps) {
  switch (props.profile.role) {
    case 'administrator': return <AdministratorDashboard {...props} />;
    case 'mine_manager': return <MineManagerDashboard {...props} />;
    case 'inspector': return <InspectorDashboard {...props} />;
    case 'regulatory_authority': return <RegulatoryAuthorityDashboard {...props} />;
    case 'corporate_management': return <CorporateManagementDashboard {...props} />;
    case 'corrective_action_owner': return <CorrectiveActionOwnerDashboard {...props} />;
    case 'verifier_approver': return <VerifierApproverDashboard {...props} />;
  }
}

function Dashboard({ profile, inspections, actions, departments, requirements, onNavigate }: { profile: UserProfile; inspections: Inspection[]; actions: CorrectiveAction[]; departments: Department[]; requirements: ComplianceRequirement[]; onNavigate: (screen: Screen) => void }) {
  const [insight, setInsight] = useState<string | null>(null);
  const [loadingInsight, setLoadingInsight] = useState(false);
  const mineRisk = useMemo(() => computeMineRiskAssessment({
    violationFrequency: Math.min(actions.length / 10, 1),
    violationSeverity: actions.length ? actions.filter((item) => item.severity === 'critical' || item.severity === 'high').length / actions.length : 0,
    overdueActions: actions.length ? actions.filter((item) => item.dueDate < new Date().toISOString().slice(0, 10) && item.status !== 'closed').length / actions.length : 0,
    historicalIncidents: 0,
    inspectionPerformance: inspections.length ? inspections.filter((item) => item.status === 'completed').length / inspections.length : 0,
    complianceCompletion: requirements.length ? requirements.filter((item) => item.status === 'completed').length / requirements.length : 0,
    recurrence: 0,
    sampleCount: actions.length + inspections.length + requirements.length,
  }), [actions, inspections, requirements]);

  const getInsight = async () => {
    setLoadingInsight(true);
    try {
      setInsight(await requestGeminiInsight('Summarize the top compliance risks for an Indian coal mine manager. Keep it to three actionable bullets.'));
    } catch (error) {
      Alert.alert('AI insight unavailable', error instanceof Error ? error.message : 'Try again later.');
    } finally {
      setLoadingInsight(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>OVERALL RISK</Text>
        <Text style={styles.heroScore}>{mineRisk.score}</Text>
        <Text style={styles.heroCopy}>{mineRisk.level.toUpperCase()} risk · {mineRisk.recommendedAttention}</Text>
        <Text style={styles.cardMeta}>Model {mineRisk.modelVersion} · {mineRisk.comparisonStart} to {mineRisk.comparisonEnd} · {mineRisk.dataSufficient ? 'Sufficient data' : 'Limited data'}</Text>
        <View style={styles.progressTrack}><View style={[styles.progress, { width: `${mineRisk.score}%` }]} /></View>
      </View>
      <View style={styles.listCard}><Text style={styles.responsibilityTitle}>Ranked contributing factors</Text>{mineRisk.contributingFactors.slice(0, 4).map((factor) => <Text style={styles.cardMeta} key={factor.key}>{factor.key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)} · {factor.points} points</Text>)}</View>
      <RoleDashboard profile={profile} inspections={inspections} actions={actions} departments={departments} requirements={requirements} onNavigate={onNavigate} />
      <TouchableOpacity style={styles.aiButton} onPress={getInsight} disabled={loadingInsight}>
        <Text style={styles.aiButtonText}>{loadingInsight ? 'Generating insight…' : '✦ Ask Gemini for a compliance brief'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={() => onNavigate('notifications')}><Text style={styles.secondaryButtonText}>View deadline notifications</Text></TouchableOpacity>
      {insight ? <View style={styles.insight}><Text style={styles.insightTitle}>AI-assisted brief</Text><Text style={styles.insightText}>{insight}</Text><Text style={styles.disclaimer}>Advisory only · review before acting</Text></View> : null}
      <Text style={styles.connection}>{isSupabaseConfigured ? '● Supabase connected' : '○ Demo mode · add .env credentials to connect Supabase'}</Text>
    </ScrollView>
  );
}

function ListScreen({ title, inspections, actions, onBack, onNew }: { title: string; inspections: Inspection[]; actions: CorrectiveAction[]; onBack: () => void; onNew?: () => void }) {
  const isInspections = title === 'Inspections';
  const items: Array<Inspection | CorrectiveAction> = isInspections ? inspections : actions;
  return (
    <View style={styles.screen}>
      <View style={styles.inlineHeader}><TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ Back</Text></TouchableOpacity><Text style={styles.screenTitle}>{title}</Text>{onNew ? <TouchableOpacity onPress={onNew}><Text style={styles.add}>＋</Text></TouchableOpacity> : <View style={{ width: 30 }} />}</View>
      <FlatList
        contentContainerStyle={styles.content}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => 'mine' in item ? (
          <View style={styles.listCard}><View style={styles.cardTop}><RiskBadge level={item.severity} /><Text style={styles.due}>{item.status.replace('_', ' ')}</Text></View><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardMeta}>{item.mine} · Due {item.dueDate}</Text></View>
        ) : (
          <View style={styles.listCard}><View style={styles.cardTop}><RiskBadge level={item.severity} /><Text style={styles.due}>{item.status.replace('_', ' ')}</Text></View><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardMeta}>Owner: {item.owner} · Due {item.dueDate}</Text></View>
        )}
      />
    </View>
  );
}

function CorrectiveActionManagement({ profile, actions, onChange, onBack }: { profile: UserProfile; actions: CorrectiveAction[]; onChange: (action: CorrectiveAction) => void; onBack: () => void }) {
  const [selected, setSelected] = useState<CorrectiveAction | null>(null);
  const [notes, setNotes] = useState('');
  const [evidenceCount, setEvidenceCount] = useState('0');
  const [reopenReason, setReopenReason] = useState('');
  const [decision, setDecision] = useState<NonNullable<CorrectiveAction['verificationDecision']>>('approved');
  const [busy, setBusy] = useState(false);
  const update = async (status: CorrectiveAction['status']) => {
    if (!selected) return;
    if (status === 'resolved' && Number(evidenceCount) < 1) return Alert.alert('Resolution evidence required', 'Upload or register at least one resolution evidence item before resolving.');
    if (['open', 'assigned', 'in_progress'].includes(status) && ['resolved', 'verified', 'closed'].includes(selected.status) && !reopenReason.trim()) return Alert.alert('Reopen reason required', 'Explain why the action is being reopened.');
    if (status === 'closed' && decision !== 'approved') return Alert.alert('Verification required', 'Only an approved verification decision can close an action.');
    setBusy(true);
    try {
      const saved = await transitionCorrectiveAction({ id: selected.id, status, progressNotes: notes, resolutionEvidenceCount: Number(evidenceCount), verificationDecision: status === 'verified' || status === 'closed' ? decision : selected.verificationDecision, verificationNotes: notes, reopenReason });
      onChange(saved); setSelected(saved); setNotes(''); Alert.alert('Action updated', `Status: ${status.replace('_', ' ')}`);
    } catch (error) { Alert.alert('Unable to update action', error instanceof Error ? error.message : 'Try again later.'); } finally { setBusy(false); }
  };
  return <ScrollView contentContainerStyle={styles.content}><View style={styles.inlineHeader}><TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ Back</Text></TouchableOpacity><Text style={styles.screenTitle}>Corrective actions</Text><View style={{ width: 30 }} /></View>{actions.map((action) => <TouchableOpacity style={styles.listCard} key={action.id} onPress={() => setSelected(action)}><View style={styles.cardTop}><RiskBadge level={action.severity} /><Text style={styles.due}>{action.status.replace('_', ' ')}</Text></View><Text style={styles.cardTitle}>#{action.actionNumber ?? 'draft'} · {action.title}</Text><Text style={styles.cardMeta}>Owner: {action.owner || 'unassigned'} · Due {action.dueDate}</Text></TouchableOpacity>)}{selected ? <View style={styles.formCard}><Text style={styles.responsibilityTitle}>{selected.title}</Text><Text style={styles.cardMeta}>Lifecycle: {selected.status.replace('_', ' ')} · Evidence: {selected.resolutionEvidenceCount ?? 0}</Text><TextInput style={[styles.input, styles.multilineInput]} value={notes} onChangeText={setNotes} multiline placeholder="Progress or verification notes" placeholderTextColor={colors.muted} /><TextInput style={styles.input} value={evidenceCount} onChangeText={setEvidenceCount} keyboardType="number-pad" placeholder="Resolution evidence count" placeholderTextColor={colors.muted} /><TextInput style={styles.input} value={decision} onChangeText={(value) => setDecision(value as NonNullable<CorrectiveAction['verificationDecision']>)} placeholder="approved, rejected, changes_requested" placeholderTextColor={colors.muted} /><TextInput style={[styles.input, styles.multilineInput]} value={reopenReason} onChangeText={setReopenReason} multiline placeholder="Reopen reason when returning to an earlier state" placeholderTextColor={colors.muted} />{selected.status === 'open' ? <TouchableOpacity style={styles.primaryButton} onPress={() => void update('assigned')} disabled={busy}><Text style={styles.primaryButtonText}>Assign action</Text></TouchableOpacity> : null}{selected.status === 'assigned' ? <TouchableOpacity style={styles.primaryButton} onPress={() => void update('in_progress')} disabled={busy}><Text style={styles.primaryButtonText}>Start progress</Text></TouchableOpacity> : null}{selected.status === 'in_progress' ? <TouchableOpacity style={styles.primaryButton} onPress={() => void update('resolved')} disabled={busy}><Text style={styles.primaryButtonText}>Submit resolution</Text></TouchableOpacity> : null}{selected.status === 'resolved' && canVerifyActions(profile.role) ? <TouchableOpacity style={styles.primaryButton} onPress={() => void update('verified')} disabled={busy}><Text style={styles.primaryButtonText}>Verify resolution</Text></TouchableOpacity> : null}{selected.status === 'verified' && canVerifyActions(profile.role) ? <TouchableOpacity style={styles.primaryButton} onPress={() => void update('closed')} disabled={busy}><Text style={styles.primaryButtonText}>Close action</Text></TouchableOpacity> : null}{['resolved', 'verified', 'closed'].includes(selected.status) ? <TouchableOpacity style={styles.secondaryButton} onPress={() => void update('in_progress')} disabled={busy}><Text style={styles.secondaryButtonText}>Reopen with reason</Text></TouchableOpacity> : null}</View> : null}</ScrollView>;
}

function InspectionWorkflow({ profile, templates, onBack, onSave }: { profile: UserProfile; templates: InspectionTemplate[]; onBack: () => void; onSave: (inspection: Inspection) => void }) {
  const [title, setTitle] = useState('');
  const [mineId, setMineId] = useState(profile.mineId ?? '');
  const [status, setStatus] = useState<Inspection['status']>('scheduled');
  const [frequency, setFrequency] = useState('one_time');
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [evidenceType, setEvidenceType] = useState('inspection');
  const [severity, setSeverity] = useState<RiskLevel>('medium');
  const [notes, setNotes] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const selectedTemplate = templates.find((item) => item.id === templateId);
  const save = async (nextStatus: Inspection['status']) => {
    if (!title.trim() || !mineId.trim()) return Alert.alert('Required fields', 'Enter an inspection title and mine ID.');
    setBusy(true);
    const nextStartedAt = startedAt ?? new Date().toISOString();
    const submittedAt = nextStatus === 'completed' ? new Date().toISOString() : null;
    const inspection: Inspection = { id: `inspection-${Date.now()}`, title: title.trim(), mine: mineId, inspector: profile.fullName, status: nextStatus, dueDate, severity, frequency, evidenceType, notes, startedAt: nextStartedAt, submittedAt, latitude: latitude ? Number(latitude) : null, longitude: longitude ? Number(longitude) : null, templateId: selectedTemplate?.id ?? null, templateVersionId: selectedTemplate?.versionId ?? null, syncState: isSupabaseConfigured ? 'synced' : 'local' };
    try {
      if (isSupabaseConfigured) {
        if (!profile.organizationId) throw new Error('Your profile has no organization scope.');
        await saveInspectionWorkflow({ organizationId: profile.organizationId, mineId, title, inspectorId: profile.id, status: nextStatus, dueDate, severity, frequency, evidenceType, notes, startedAt: nextStartedAt, submittedAt, latitude: inspection.latitude ?? null, longitude: inspection.longitude ?? null, templateId: selectedTemplate?.id ?? null, templateVersionId: selectedTemplate?.versionId ?? null });
      }
      setStartedAt(nextStartedAt);
      setStatus(nextStatus);
      onSave(inspection);
      if (nextStatus === 'completed') Alert.alert('Inspection submitted', 'The submission is complete and ready for review.');
    } catch (error) {
      Alert.alert('Unable to save inspection', error instanceof Error ? error.message : 'The inspection remains available locally.');
    } finally {
      setBusy(false);
    }
  };
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><View style={styles.inlineHeader}><TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ Back</Text></TouchableOpacity><Text style={styles.screenTitle}>Inspection workflow</Text><View style={{ width: 30 }} /></View><ScrollView contentContainerStyle={styles.content}><Text style={styles.workflowStep}>1. Select mine and template</Text><Text style={styles.fieldLabel}>Inspection title / template *</Text><TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. PPE compliance walk-through" placeholderTextColor={colors.muted} /><View style={styles.choiceRow}>{templates.map((item) => <TouchableOpacity key={item.id} style={[styles.choice, templateId === item.id && styles.choiceSelected]} onPress={() => { setTemplateId(item.id); setTitle(item.name); setSeverity(item.sections[0]?.questions[0]?.severityDefault ?? 'medium'); }}><Text style={styles.choiceText}>{item.name} v{item.versionNumber ?? '?'}</Text></TouchableOpacity>)}</View>{selectedTemplate ? <Text style={styles.cardMeta}>{selectedTemplate.sections.reduce((count, section) => count + section.questions.length, 0)} checklist questions · version retained on submission</Text> : null}<Text style={styles.fieldLabel}>Mine ID *</Text><TextInput style={styles.input} value={mineId} onChangeText={setMineId} placeholder="Authorized mine UUID" placeholderTextColor={colors.muted} autoCapitalize="none" /><Text style={styles.fieldLabel}>Frequency / due date</Text><TextInput style={styles.input} value={frequency} onChangeText={setFrequency} placeholder="one_time, daily, weekly..." placeholderTextColor={colors.muted} /><TextInput style={styles.input} value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} /><Text style={styles.workflowStep}>2. Checklist and evidence</Text>{selectedTemplate?.sections.map((section) => <View key={section.key} style={styles.formCard}><Text style={styles.responsibilityTitle}>{section.title}</Text>{section.questions.map((question) => <Text style={styles.cardMeta} key={question.key}>• {question.prompt} ({question.responseType}){question.evidenceRequired ? ' · evidence required' : ''}</Text>)}</View>)}<TextInput style={styles.input} value={evidenceType} onChangeText={setEvidenceType} placeholder="Evidence type: inspection, photo, document..." placeholderTextColor={colors.muted} /><TextInput style={styles.input} value={severity} onChangeText={(value) => setSeverity(value as RiskLevel)} placeholder="Severity: low, medium, high, critical" placeholderTextColor={colors.muted} /><TextInput style={[styles.input, styles.multilineInput]} value={notes} onChangeText={setNotes} multiline placeholder="Observations, checklist notes, immediate actions" placeholderTextColor={colors.muted} /><Text style={styles.workflowStep}>3. Location and timestamp</Text><Text style={styles.captureUnavailable}>Camera/GPS native capture is unavailable in this build. Request permission and attach evidence when the supported Expo modules are added.</Text><TextInput style={styles.input} value={latitude} onChangeText={setLatitude} placeholder="Latitude (optional)" placeholderTextColor={colors.muted} keyboardType="decimal-pad" /><TextInput style={styles.input} value={longitude} onChangeText={setLongitude} placeholder="Longitude (optional)" placeholderTextColor={colors.muted} keyboardType="decimal-pad" /><Text style={styles.syncState}>Status: {status.replace('_', ' ')} · {isSupabaseConfigured ? 'sync enabled' : 'local demo draft'}</Text><View style={styles.workflowButtons}>{status === 'scheduled' ? <TouchableOpacity style={styles.primaryButton} onPress={() => void save('in_progress')} disabled={busy}><Text style={styles.primaryButtonText}>{busy ? 'Starting…' : 'Start inspection'}</Text></TouchableOpacity> : null}{status === 'in_progress' ? <TouchableOpacity style={styles.secondaryButton} onPress={() => void save('paused')} disabled={busy}><Text style={styles.secondaryButtonText}>Pause</Text></TouchableOpacity> : null}{status === 'paused' ? <TouchableOpacity style={styles.primaryButton} onPress={() => void save('in_progress')} disabled={busy}><Text style={styles.primaryButtonText}>Resume</Text></TouchableOpacity> : null}{status === 'in_progress' || status === 'paused' ? <TouchableOpacity style={styles.primaryButton} onPress={() => void save('completed')} disabled={busy}><Text style={styles.primaryButtonText}>Review and submit</Text></TouchableOpacity> : null}</View></ScrollView></KeyboardAvoidingView>;
}

function LoginScreen({ onSignedIn }: { onSignedIn: (profile: UserProfile) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    if (!supabase) return;
    if (!email.trim() || !password) return Alert.alert('Sign in required', 'Enter your email and password.');
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return Alert.alert('Unable to sign in', error.message);
    try {
      onSignedIn(await loadUserProfile(data.user.id));
    } catch (error) {
      await supabase.auth.signOut();
      Alert.alert('Profile unavailable', error instanceof Error ? error.message : 'Your account is not configured for MinePulse.');
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.authContent}>
          <Text style={styles.eyebrow}>MINEPULSE</Text>
          <Text style={styles.authTitle}>Compliance, from the field.</Text>
          <Text style={styles.subtitle}>Sign in to your mine workspace and keep inspections moving, even when connectivity is limited.</Text>
          <Text style={styles.fieldLabel}>Work email</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@company.com" placeholderTextColor={colors.muted} />
          <Text style={styles.fieldLabel}>Password</Text>
          <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" placeholderTextColor={colors.muted} />
          <TouchableOpacity style={styles.primaryButton} onPress={signIn} disabled={busy}><Text style={styles.primaryButtonText}>{busy ? 'Signing in…' : 'Sign in'}</Text></TouchableOpacity>
          {!isSupabaseConfigured ? <Text style={styles.connection}>Demo mode is active until Supabase environment variables are configured.</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AppContent() {
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [inspections, setInspections] = useState(demoInspections);
  const [actions, setActions] = useState(demoActions);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [requirements, setRequirements] = useState<ComplianceRequirement[]>([]);
  const [templates, setTemplates] = useState<InspectionTemplate[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [signedIn, setSignedIn] = useState(!isSupabaseConfigured);
  const [profile, setProfile] = useState<UserProfile | null>(
    isSupabaseConfigured ? null : {
      id: 'demo-user',
      fullName: 'Priya Sharma',
      role: 'mine_manager',
      organizationId: null,
      mineId: null,
    },
  );

  if (!signedIn) return <LoginScreen onSignedIn={(nextProfile) => { setProfile(nextProfile); setSignedIn(true); }} />;
  if (!profile) return <SafeAreaView style={styles.screen}><Text style={styles.connection}>Loading your authorized workspace…</Text></SafeAreaView>;
  if (screen === 'inspections' && canViewInspections(profile.role)) return <SafeAreaView style={styles.screen}><ListScreen title="Inspections" inspections={inspections} actions={actions} onBack={() => setScreen('dashboard')} onNew={canCreateInspection(profile.role) ? () => setScreen('new-inspection') : undefined} /></SafeAreaView>;
  if (screen === 'actions' && canViewActions(profile.role)) return <SafeAreaView style={styles.screen}><CorrectiveActionManagement profile={profile} actions={actions} onBack={() => setScreen('dashboard')} onChange={(action) => setActions((current) => [...current.filter((item) => item.id !== action.id), action])} /></SafeAreaView>;
  if (screen === 'new-inspection' && canCreateInspection(profile.role)) return <SafeAreaView style={styles.screen}><InspectionWorkflow profile={profile} templates={templates} onBack={() => setScreen('inspections')} onSave={(inspection) => { setInspections((current) => [inspection, ...current]); setScreen('inspections'); }} /></SafeAreaView>;
  if (screen === 'departments' && canManageDepartments(profile.role)) return <SafeAreaView style={styles.screen}><DepartmentManagement profile={profile} departments={departments} onBack={() => setScreen('dashboard')} onChange={(department) => setDepartments((current) => [...current.filter((item) => item.id !== department.id), department])} /></SafeAreaView>;
  if (screen === 'requirements' && canViewCompliance(profile.role)) return <SafeAreaView style={styles.screen}><ComplianceRequirementManagement profile={profile} requirements={requirements} onBack={() => setScreen('dashboard')} onChange={(requirement) => setRequirements((current) => [...current.filter((item) => item.id !== requirement.id), requirement])} /></SafeAreaView>;
  if (screen === 'templates' && canManageTemplates(profile.role)) return <SafeAreaView style={styles.screen}><InspectionTemplateManagement profile={profile} templates={templates} onBack={() => setScreen('dashboard')} onChange={(template) => setTemplates((current) => [...current.filter((item) => item.id !== template.id), template])} /></SafeAreaView>;
  if (screen === 'observations') return <SafeAreaView style={styles.screen}><ObservationManagement profile={profile} observations={observations} onBack={() => setScreen('dashboard')} onChange={(observation) => setObservations((current) => [observation, ...current.filter((item) => item.id !== observation.id)])} /></SafeAreaView>;
  if (screen === 'notifications') return <SafeAreaView style={styles.screen}><NotificationCenter notifications={notifications} onBack={() => setScreen('dashboard')} onAcknowledge={async (notification) => { try { await acknowledgeNotification(notification.id); setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, status: 'acknowledged', acknowledgedAt: new Date().toISOString() } : item)); } catch (error) { Alert.alert('Unable to acknowledge', error instanceof Error ? error.message : 'Try again later.'); } }} /></SafeAreaView>;
  return <SafeAreaView style={styles.screen}><StatusBar style="dark" /><Dashboard profile={profile} inspections={inspections} actions={actions} departments={departments} requirements={requirements} onNavigate={async (nextScreen) => { setScreen(nextScreen); try { if (nextScreen === 'departments') setDepartments(await loadDepartments()); if (nextScreen === 'requirements') setRequirements(await loadComplianceRequirements()); if (nextScreen === 'templates') setTemplates(await loadInspectionTemplates()); if (nextScreen === 'observations') setObservations(await loadObservations({})); if (nextScreen === 'actions' && isSupabaseConfigured) setActions(await loadCorrectiveActions()); if (nextScreen === 'notifications') setNotifications(await loadNotifications()); } catch (error) { Alert.alert('Unable to load data', error instanceof Error ? error.message : 'Try again later.'); } }} /></SafeAreaView>;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, paddingBottom: 40 },
  authContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  authTitle: { color: colors.ink, fontSize: 35, fontWeight: '800', lineHeight: 40, marginTop: 12, marginBottom: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 },
  eyebrow: { color: colors.accent, fontWeight: '800', letterSpacing: 2, fontSize: 11 },
  title: { color: colors.ink, fontSize: 29, fontWeight: '800', marginTop: 6 },
  subtitle: { color: colors.muted, marginTop: 5, fontSize: 14 },
  statusDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.accent, marginTop: 8 },
  roleBanner: { backgroundColor: colors.accentSoft, borderRadius: 14, padding: 14, marginBottom: 14 },
  roleText: { color: colors.accent, fontWeight: '800', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.7 },
  roleFocus: { color: colors.ink, marginTop: 4, fontWeight: '600' },
  responsibilityCard: { backgroundColor: colors.card, borderRadius: 16, padding: 17, marginBottom: 14, borderWidth: 1, borderColor: colors.line },
  responsibilityTitle: { color: colors.ink, fontWeight: '800', fontSize: 16, marginBottom: 8 },
  responsibilityItem: { color: colors.muted, lineHeight: 22 },
  secondaryButton: { borderWidth: 1, borderColor: colors.accent, borderRadius: 13, padding: 14, marginBottom: 18 },
  secondaryButtonText: { color: colors.accent, textAlign: 'center', fontWeight: '800' },
  departmentActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  archiveText: { color: colors.danger, fontWeight: '700' },
  formCard: { backgroundColor: colors.card, borderRadius: 16, padding: 17, marginTop: 8, borderWidth: 1, borderColor: colors.line },
  multilineInput: { minHeight: 90, textAlignVertical: 'top' },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  choice: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8 },
  choiceSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  choiceText: { color: colors.ink, fontSize: 12, textTransform: 'capitalize' },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  statusCard: { width: '31%', minWidth: 90, backgroundColor: colors.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.line },
  statusValue: { color: colors.accent, fontSize: 22, fontWeight: '800' },
  statusLabel: { color: colors.muted, fontSize: 11, marginTop: 3, textTransform: 'capitalize' },
  hero: { backgroundColor: colors.ink, borderRadius: 22, padding: 22, marginBottom: 14 },
  heroLabel: { color: '#A7CFC4', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  heroScore: { color: '#FFFFFF', fontSize: 58, fontWeight: '800', marginTop: 4 },
  heroCopy: { color: '#D5E5E0', lineHeight: 20, marginTop: 2 },
  progressTrack: { height: 7, backgroundColor: '#31504A', borderRadius: 4, marginTop: 18 },
  progress: { height: 7, backgroundColor: '#6BD0B5', borderRadius: 4 },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  statCard: { flex: 1, backgroundColor: colors.card, borderRadius: 16, padding: 17, borderWidth: 1, borderColor: colors.line },
  statValue: { color: colors.accent, fontSize: 28, fontWeight: '800' },
  statLabel: { color: colors.muted, marginTop: 4 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  sectionHint: { color: colors.muted, fontSize: 13 },
  listCard: { backgroundColor: colors.card, borderRadius: 16, padding: 17, marginBottom: 11, borderWidth: 1, borderColor: colors.line },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardTitle: { color: colors.ink, fontWeight: '700', fontSize: 16, lineHeight: 22 },
  cardMeta: { color: colors.muted, marginTop: 6, fontSize: 13 },
  due: { color: colors.muted, fontSize: 12, textTransform: 'capitalize' },
  badge: { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  aiButton: { backgroundColor: colors.accentSoft, borderRadius: 14, padding: 16, marginTop: 5 },
  aiButtonText: { color: colors.accent, textAlign: 'center', fontWeight: '800' },
  insight: { backgroundColor: '#FFF8EA', borderColor: '#F0D7A4', borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 12 },
  insightTitle: { color: colors.ink, fontWeight: '800' },
  insightText: { color: colors.ink, lineHeight: 21, marginTop: 7 },
  disclaimer: { color: colors.warning, fontSize: 11, marginTop: 10, fontWeight: '700' },
  connection: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 24 },
  inlineHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: colors.line },
  back: { color: colors.accent, fontWeight: '700', width: 55 },
  screenTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  add: { color: colors.accent, fontSize: 26, width: 30, textAlign: 'right' },
  fieldLabel: { color: colors.ink, fontWeight: '800', marginBottom: 8, marginTop: 12 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, color: colors.ink, fontSize: 16 },
  primaryButton: { backgroundColor: colors.accent, borderRadius: 13, padding: 16, marginTop: 25 },
  primaryButtonText: { color: '#FFFFFF', textAlign: 'center', fontWeight: '800', fontSize: 16 },
  workflowStep: { color: colors.accent, fontSize: 16, fontWeight: '800', marginTop: 18, marginBottom: 4 },
  captureUnavailable: { color: colors.warning, backgroundColor: '#FFF8EA', borderRadius: 12, padding: 12, lineHeight: 19, marginBottom: 8 },
  syncState: { color: colors.muted, fontSize: 12, marginTop: 18, textTransform: 'capitalize' },
  workflowButtons: { marginTop: 2 },
});
