import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Clock,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Globe,
  Info,
  LayoutDashboard,
  Loader2,
  LogOut,
  Megaphone,
  Menu,
  Monitor,
  Moon,
  MoreHorizontal,
  MoreVertical,
  PanelLeft,
  Pencil,
  Phone,
  PhoneCall,
  PhoneMissed,
  PhoneOff,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sun,
  Trash2,
  Upload,
  User,
  UserCircle2,
  Users,
  X,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';
import * as React from 'react';

export type { LucideIcon };

const DEFAULT_SIZE = 16;
const DEFAULT_STROKE_WIDTH = 1.5;

function withDefaults(Icon: LucideIcon): React.FC<LucideProps> {
  function WrappedIcon({ size = DEFAULT_SIZE, strokeWidth = DEFAULT_STROKE_WIDTH, ...props }: LucideProps) {
    return <Icon size={size} strokeWidth={strokeWidth} {...props} />;
  }
  WrappedIcon.displayName = Icon.displayName ?? Icon.name;
  return WrappedIcon;
}

export const Icons = {
  // Navigation
  LayoutDashboard: withDefaults(LayoutDashboard),
  Megaphone: withDefaults(Megaphone),
  Users: withDefaults(Users),
  FileText: withDefaults(FileText),
  CreditCard: withDefaults(CreditCard),
  Settings: withDefaults(Settings),

  // Top bar / shell
  Search: withDefaults(Search),
  Bell: withDefaults(Bell),
  Menu: withDefaults(Menu),
  PanelLeft: withDefaults(PanelLeft),
  LogOut: withDefaults(LogOut),

  // Chevrons / navigation
  ChevronDown: withDefaults(ChevronDown),
  ChevronUp: withDefaults(ChevronUp),
  ChevronLeft: withDefaults(ChevronLeft),
  ChevronRight: withDefaults(ChevronRight),
  ChevronsLeft: withDefaults(ChevronsLeft),
  ChevronsRight: withDefaults(ChevronsRight),
  ChevronsUpDown: withDefaults(ChevronsUpDown),

  // Actions
  Plus: withDefaults(Plus),
  X: withDefaults(X),
  Pencil: withDefaults(Pencil),
  Trash2: withDefaults(Trash2),
  Check: withDefaults(Check),
  MoreHorizontal: withDefaults(MoreHorizontal),
  MoreVertical: withDefaults(MoreVertical),
  Copy: withDefaults(Copy),
  ExternalLink: withDefaults(ExternalLink),
  Eye: withDefaults(Eye),
  EyeOff: withDefaults(EyeOff),
  Filter: withDefaults(Filter),
  Download: withDefaults(Download),
  Upload: withDefaults(Upload),
  RefreshCw: withDefaults(RefreshCw),
  Calendar: withDefaults(Calendar),

  // Status
  CheckCircle2: withDefaults(CheckCircle2),
  AlertCircle: withDefaults(AlertCircle),
  AlertTriangle: withDefaults(AlertTriangle),
  Info: withDefaults(Info),
  Clock: withDefaults(Clock),
  Loader2: withDefaults(Loader2),

  // Theme / locale
  Sun: withDefaults(Sun),
  Moon: withDefaults(Moon),
  Monitor: withDefaults(Monitor),
  Globe: withDefaults(Globe),

  // Entities
  Building2: withDefaults(Building2),
  User: withDefaults(User),
  UserCircle2: withDefaults(UserCircle2),
  Phone: withDefaults(Phone),
  PhoneCall: withDefaults(PhoneCall),
  PhoneMissed: withDefaults(PhoneMissed),
  PhoneOff: withDefaults(PhoneOff),
} as const;
