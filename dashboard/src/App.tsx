import { useEffect, useMemo, useState } from "react"
import type { Dispatch, FormEvent, SetStateAction } from "react"
import type { LucideIcon } from "lucide-react"
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Database,
  FileText,
  KeyRound,
  Loader2,
  LogOut,
  Moon,
  Plus,
  QrCode,
  RefreshCw,
  Save,
  Search,
  Server,
  Shield,
  ShieldAlert,
  Smartphone,
  Sun,
  Trash2,
  Wifi,
  XCircle,
} from "lucide-react"
import { toDataURL } from "qrcode"
import { toast } from "sonner"

import {
  apiRequest,
  clearSession,
  createSession,
  type Category,
  type CategoryRulePreview,
  type Credentials,
  type DomainCheckResult,
  type EventSnapshot,
  getSession,
  type Profile,
  type ProfileAudit,
  type ProfileSummary,
  type ProfileTemplate,
  type QueryLogEntry,
  ruleRowsFromTextarea,
  rulesToTextarea,
  type Status,
} from "@/api"
import { useTheme } from "@/components/theme-provider"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type DetailDraft = {
  name: string
  deviceName: string
  active: boolean
  rulesText: string
}

type LiveState = "connecting" | "live" | "offline"

const emptyDraft: DetailDraft = {
  name: "",
  deviceName: "",
  active: true,
  rulesText: "",
}

function formatDate(value?: number | string | null) {
  if (!value) {
    return "-"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat("es-MX", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function reasonLabel(reason: string) {
  if (reason === "FilteredBlockedService") {
    return "servicio"
  }

  if (reason.startsWith("Filtered")) {
    return "regla"
  }

  return "permitido"
}

function liveLabel(liveState: LiveState) {
  if (liveState === "live") {
    return "En Vivo"
  }

  if (liveState === "connecting") {
    return "Conectando"
  }

  return "Sin Conexion"
}

function statusLabel(value?: string) {
  if (!value) {
    return "Sin Estado"
  }

  if (value.toLowerCase() === "ok") {
    return "OK"
  }

  if (value.toLowerCase() === "degraded") {
    return "Degradado"
  }

  return value.charAt(0).toUpperCase() + value.slice(1)
}

function StatusPill({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  icon: LucideIcon
  tone: "green" | "amber" | "red"
}) {
  const tones = {
    green: "border-border bg-background text-foreground",
    amber: "border-border bg-background text-muted-foreground",
    red: "border-destructive/30 bg-background text-destructive",
  }

  return (
    <div className={cn("flex h-8 items-center gap-2 border px-2.5 text-xs", tones[tone])}>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  )
}

function MetricTile({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string
  value: string | number
  icon: LucideIcon
  tone?: "neutral" | "green" | "blue" | "amber"
}) {
  const tones = {
    neutral: "text-muted-foreground",
    green: "text-muted-foreground",
    blue: "text-muted-foreground",
    amber: "text-muted-foreground",
  }

  return (
    <div className="border bg-background p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className={cn("grid size-6 place-items-center border bg-muted/40", tones[tone])}>
          <Icon className="size-3.5" />
        </span>
        {label}
      </div>
      <div className="mt-2 truncate font-mono text-xl font-semibold tracking-normal">{value}</div>
    </div>
  )
}

function CompactStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border bg-background p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-base font-semibold text-primary">{value}</div>
    </div>
  )
}

function App() {
  const { theme, setTheme } = useTheme()
  const [authenticated, setAuthenticated] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [sessionKey, setSessionKey] = useState("")
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [templates, setTemplates] = useState<ProfileTemplate[]>([])
  const [status, setStatus] = useState<Status | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null)
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [audit, setAudit] = useState<ProfileAudit | null>(null)
  const [logs, setLogs] = useState<QueryLogEntry[]>([])
  const [draft, setDraft] = useState<DetailDraft>(emptyDraft)
  const [categorySelections, setCategorySelections] = useState<Record<string, boolean>>({})
  const [loadingDashboard, setLoadingDashboard] = useState(false)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [creatingProfile, setCreatingProfile] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [refreshingBlocklists, setRefreshingBlocklists] = useState(false)
  const [liveState, setLiveState] = useState<LiveState>("offline")
  const [lastLiveAt, setLastLiveAt] = useState<number | null>(null)
  const [profileFilter, setProfileFilter] = useState("")
  const [createRulesText, setCreateRulesText] = useState("")
  const [createPersonalOnly, setCreatePersonalOnly] = useState(false)
  const [createTemplateId, setCreateTemplateId] = useState("basic_safe")
  const [showCreatePanel, setShowCreatePanel] = useState(false)

  const selectedSummary = useMemo(
    () => profiles.find((profile) => profile.id === selectedId) || null,
    [profiles, selectedId]
  )

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === createTemplateId) || templates[0] || null,
    [createTemplateId, templates]
  )

  const filteredProfiles = useMemo(() => {
    const query = profileFilter.trim().toLowerCase()
    if (!query) {
      return profiles
    }

    return profiles.filter((profile) =>
      [profile.id, profile.name, profile.device_name || ""].join(" ").toLowerCase().includes(query)
    )
  }, [profileFilter, profiles])

  const blockedLogs = useMemo(() => logs.filter((entry) => entry.status === "blocked"), [logs])

  function hydrateDraft(profile: Profile) {
    setDraft({
      name: profile.name || "",
      deviceName: profile.device_name || "",
      active: profile.active,
      rulesText: rulesToTextarea(profile.rules || []),
    })

    setCategorySelections(Object.fromEntries(profile.categories.map((entry) => [entry.category, entry.enabled])))
  }

  async function loadProfile(profileId: string) {
    setLoadingProfile(true)
    try {
      const [profileData, credentialsData, auditData, logsData] = await Promise.all([
        apiRequest<{ profile: Profile }>(`/api/profiles/${profileId}`),
        apiRequest<Credentials>(`/api/profiles/${profileId}/credentials`),
        apiRequest<ProfileAudit>(`/api/profiles/${profileId}/audit`),
        apiRequest<{ logs: QueryLogEntry[] }>(`/api/profiles/${profileId}/logs?limit=120`),
      ])

      setSelectedId(profileId)
      setSelectedProfile(profileData.profile)
      setCredentials(credentialsData)
      setAudit(auditData)
      setLogs(logsData.logs)
      hydrateDraft(profileData.profile)
    } finally {
      setLoadingProfile(false)
    }
  }

  async function loadDashboard(nextSelectedId = selectedId) {
    setLoadingDashboard(true)
    try {
      const [profilesData, categoriesData, templatesData, statusData] = await Promise.all([
        apiRequest<{ profiles: ProfileSummary[] }>("/api/profiles"),
        apiRequest<{ categories: Category[] }>("/api/blocklists/categories"),
        apiRequest<{ templates: ProfileTemplate[] }>("/api/profile-templates"),
        apiRequest<Status>("/api/status"),
      ])

      setProfiles(profilesData.profiles)
      setCategories(categoriesData.categories)
      setTemplates(templatesData.templates)
      if (!templatesData.templates.some((template) => template.id === createTemplateId)) {
        setCreateTemplateId(templatesData.templates[0]?.id || "basic_safe")
      }
      setStatus(statusData)

      const targetId =
        nextSelectedId && profilesData.profiles.some((profile) => profile.id === nextSelectedId)
          ? nextSelectedId
          : profilesData.profiles[0]?.id || null

      if (targetId) {
        await loadProfile(targetId)
      } else {
        setSelectedId(null)
        setSelectedProfile(null)
        setCredentials(null)
        setAudit(null)
        setLogs([])
        setDraft(emptyDraft)
        setCategorySelections({})
      }
    } catch (error) {
      if (error instanceof Error && /unauthorized|token/i.test(error.message)) {
        setAuthenticated(false)
      }

      toast.error(error instanceof Error ? error.message : "No se pudo cargar GDNS.")
    } finally {
      setLoadingDashboard(false)
    }
  }

  async function checkSession() {
    try {
      const session = await getSession()
      setAuthenticated(session.authenticated)
      if (session.authenticated) {
        await loadDashboard(null)
      }
    } catch {
      setAuthenticated(false)
    } finally {
      setCheckingSession(false)
    }
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const token = sessionKey.trim()
    if (!token) {
      toast.error("Escribe la clave de consola.")
      return
    }

    try {
      await createSession(token)
      setSessionKey("")
      setAuthenticated(true)
      toast.success("Sesion iniciada.")
      await loadDashboard(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo iniciar sesion.")
    }
  }

  async function disconnect() {
    await clearSession()
    setAuthenticated(false)
    setProfiles([])
    setCategories([])
    setTemplates([])
    setStatus(null)
    setSelectedId(null)
    setSelectedProfile(null)
    setCredentials(null)
    setAudit(null)
    setLogs([])
    setLiveState("offline")
  }

  async function createProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const id = String(form.get("id") || "")
      .toLowerCase()
      .trim()
    const name = String(form.get("name") || "").trim()
    const deviceName = String(form.get("device_name") || "").trim()
    const templateRules = selectedTemplate?.rules || []
    const personalRules = ruleRowsFromTextarea(createRulesText)
    const templateCategories = selectedTemplate?.categories || []
    const usePersonalOnly = createPersonalOnly || selectedTemplate?.id === "personal"

    setCreatingProfile(true)
    try {
      const created = await apiRequest<{ profile: Profile }>("/api/profiles", {
        method: "POST",
        body: {
          id,
          name,
          device_name: deviceName,
          categories: usePersonalOnly ? {} : templateCategories,
          ...(templateRules.length + personalRules.length > 0 ? { rules: [...templateRules, ...personalRules] } : {}),
        },
      })
      event.currentTarget.reset()
      setCreateRulesText("")
      setCreatePersonalOnly(false)
      setCreateTemplateId("basic_safe")
      setShowCreatePanel(false)
      toast.success("Perfil creado.")
      await loadDashboard(created.profile.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear el perfil.")
    } finally {
      setCreatingProfile(false)
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedProfile) {
      return
    }

    setSaving(true)
    try {
      await apiRequest(`/api/profiles/${selectedProfile.id}`, {
        method: "PUT",
        body: {
          name: draft.name,
          device_name: draft.deviceName,
          active: draft.active,
          categories: categorySelections,
          rules: ruleRowsFromTextarea(draft.rulesText),
        },
      })
      toast.success("Cambios aplicados.")
      await loadDashboard(selectedProfile.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar.")
    } finally {
      setSaving(false)
    }
  }

  async function syncProfile() {
    if (!selectedProfile) {
      return
    }

    setSyncing(true)
    try {
      await apiRequest(`/api/profiles/${selectedProfile.id}/sync`, {
        method: "POST",
      })
      toast.success("Perfil reaplicado.")
      await loadDashboard(selectedProfile.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo reaplicar.")
    } finally {
      setSyncing(false)
    }
  }

  async function deleteProfile() {
    if (!selectedProfile) {
      return
    }

    try {
      await apiRequest(`/api/profiles/${selectedProfile.id}`, {
        method: "DELETE",
      })
      toast.success("Perfil eliminado.")
      await loadDashboard(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar.")
    }
  }

  async function refreshBlocklists() {
    setRefreshingBlocklists(true)
    try {
      await apiRequest("/api/blocklists/refresh", {
        method: "POST",
        body: {},
      })
      toast.success("Listas actualizadas.")
      await loadDashboard(selectedId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron refrescar las listas.")
    } finally {
      setRefreshingBlocklists(false)
    }
  }

  async function refreshLogs() {
    if (!selectedId) {
      return
    }

    try {
      const logsData = await apiRequest<{ logs: QueryLogEntry[] }>(`/api/profiles/${selectedId}/logs?limit=120`)
      setLogs(logsData.logs)
      toast.success("Actividad actualizada.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar la actividad.")
    }
  }

  async function copyText(value: string, label: string) {
    await navigator.clipboard.writeText(value)
    toast.success(`${label} copiado.`)
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void checkSession()
    }, 0)

    return () => window.clearTimeout(timeout)
    // Initial session bootstrap only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!authenticated) {
      return undefined
    }

    const params = new URLSearchParams({ limit: "120" })
    if (selectedId) {
      params.set("profile_id", selectedId)
    }

    const connectingTimeout = window.setTimeout(() => setLiveState("connecting"), 0)
    const source = new EventSource(`/api/events?${params.toString()}`)

    const onSnapshot = (event: MessageEvent<string>) => {
      const snapshot = JSON.parse(event.data) as EventSnapshot
      setStatus(snapshot.status)
      setProfiles(snapshot.profiles)
      setLastLiveAt(snapshot.emitted_at)
      setLiveState("live")

      if (snapshot.profile_id && snapshot.profile_id === selectedId) {
        setLogs(snapshot.logs)
      }
    }

    const onError = () => {
      setLiveState("offline")
    }

    source.addEventListener("snapshot", onSnapshot as EventListener)
    source.addEventListener("error", onError)

    return () => {
      window.clearTimeout(connectingTimeout)
      source.removeEventListener("snapshot", onSnapshot as EventListener)
      source.removeEventListener("error", onError)
      source.close()
    }
  }, [authenticated, selectedId])

  const systemOk = status?.ok === true

  if (checkingSession) {
    return <LoadingScreen />
  }

  if (!authenticated) {
    return <LoginScreen sessionKey={sessionKey} setSessionKey={setSessionKey} onSubmit={connect} />
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      {creatingProfile ? <PageBusyOverlay message="Creando perfil" /> : null}
      <header className="sticky top-0 z-20 border-b bg-background">
        <div className="mx-auto flex max-w-[1680px] flex-col gap-3 px-4 py-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <img src="/goat_dns.svg" alt="Goat DNS" className="h-16 w-auto max-w-[210px] shrink-0 object-contain" />
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-xs text-muted-foreground">
                {selectedSummary
                  ? `${selectedSummary.id} preparado para Private DNS`
                  : "Perfiles, filtros y actividad en tiempo real"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              label="Sync"
              value={liveLabel(liveState)}
              icon={liveState === "live" ? CheckCircle2 : AlertTriangle}
              tone={liveState === "live" ? "green" : "amber"}
            />
            <StatusPill
              label="Motor"
              value={statusLabel(status?.status)}
              icon={systemOk ? Wifi : XCircle}
              tone={systemOk ? "green" : "red"}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => void loadDashboard(selectedId)}
            >
              <RefreshCw className={cn("size-4", loadingDashboard && "animate-spin")} />
              Actualizar
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Cambiar tema"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Cerrar sesion"
              onClick={() => void disconnect()}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1680px] gap-4 p-4 lg:grid-cols-[292px_minmax(0,1fr)_326px] 2xl:grid-cols-[320px_minmax(0,1fr)_340px]">
        <aside className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Perfiles</CardTitle>
              <CardAction>
                <Badge variant="secondary">{profiles.length}</Badge>
              </CardAction>
              <CardDescription>El ID sera parte del hostname privado.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={profileFilter}
                  onChange={(event) => setProfileFilter(event.target.value)}
                  className="pl-8"
                  placeholder="Buscar perfil"
                />
              </div>

              {loadingDashboard && profiles.length === 0 ? (
                <LoadingRows />
              ) : filteredProfiles.length === 0 ? (
                <div className="border border-dashed p-6 text-center text-sm text-muted-foreground">Sin perfiles.</div>
              ) : (
                <div className="grid gap-2">
                  {filteredProfiles.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      className={cn(
                        "grid w-full gap-1 border bg-background p-3 text-left transition hover:border-primary/50 hover:bg-muted/40",
                        profile.id === selectedId && "border-primary bg-primary/5"
                      )}
                      onClick={() => void loadProfile(profile.id)}
                    >
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="truncate font-medium">{profile.id}</span>
                        <Badge variant={profile.active ? "default" : "outline"}>
                          {profile.active ? "activo" : "pausado"}
                        </Badge>
                      </div>
                      <span className="truncate text-xs text-muted-foreground">
                        {profile.device_name || profile.name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Nuevo perfil</CardTitle>
              <CardAction>
                <Button
                  type="button"
                  variant={showCreatePanel ? "ghost" : "default"}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setShowCreatePanel((current) => !current)}
                >
                  {showCreatePanel ? <XCircle className="size-3.5" /> : <Plus className="size-3.5" />}
                  {showCreatePanel ? "Cerrar" : "Crear"}
                </Button>
              </CardAction>
              <CardDescription>
                {showCreatePanel
                  ? "Un perfil por grupo o dispositivo."
                  : selectedTemplate
                    ? `Plantilla lista: ${selectedTemplate.name}`
                    : "Crea perfiles cuando lo necesites."}
              </CardDescription>
            </CardHeader>
            {showCreatePanel ? (
              <CardContent>
                <form className="grid gap-3" onSubmit={createProfile}>
                  <div className="grid gap-1.5">
                    <Label htmlFor="profile-id">ID</Label>
                    <Input
                      id="profile-id"
                      name="id"
                      required
                      pattern="[-a-z0-9]{3,63}"
                      title="3 a 63 caracteres: minusculas, numeros y guiones."
                      placeholder="abc123"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="profile-name">Nombre</Label>
                    <Input id="profile-name" name="name" required placeholder="Pixel" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="device-name">Dispositivo</Label>
                    <Input id="device-name" name="device_name" placeholder="Pixel 8" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Plantilla</Label>
                    <div className="grid gap-2">
                      {templates.length === 0 ? (
                        <Skeleton className="h-16 w-full" />
                      ) : (
                        templates.map((template) => {
                          const selected = template.id === createTemplateId
                          return (
                            <button
                              key={template.id}
                              type="button"
                              className={cn(
                                "grid gap-1 border bg-background p-3 text-left transition hover:border-primary/50 hover:bg-muted/40",
                                selected && "border-primary bg-primary/5"
                              )}
                              onClick={() => {
                                setCreateTemplateId(template.id)
                                setCreatePersonalOnly(template.id === "personal")
                              }}
                            >
                              <span className="flex items-center justify-between gap-2">
                                <span className="font-medium">{template.name}</span>
                                <Badge variant={selected ? "default" : "secondary"}>{template.categories.length}</Badge>
                              </span>
                              <span className="text-xs text-muted-foreground">{template.description}</span>
                            </button>
                          )
                        })
                      )}
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="create-rules">Reglas personales</Label>
                    <Textarea
                      id="create-rules"
                      rows={5}
                      spellCheck={false}
                      className="font-mono text-xs leading-relaxed"
                      placeholder={"block ||example.org^\nallow ||safe.example.org^"}
                      value={createRulesText}
                      onChange={(event) => setCreateRulesText(event.target.value)}
                    />
                  </div>
                  <label className="flex items-start gap-2 border bg-background p-3 text-sm">
                    <Checkbox
                      checked={createPersonalOnly}
                      onCheckedChange={(checked) => setCreatePersonalOnly(Boolean(checked))}
                    />
                    <span className="grid gap-0.5">
                      <span className="font-medium">Solo reglas personales</span>
                      <span className="text-xs text-muted-foreground">
                        Crea el perfil sin filtros base; despues puedes activar categorias.
                      </span>
                    </span>
                  </label>
                  <Button type="submit" className="gap-1.5" disabled={creatingProfile}>
                    {creatingProfile ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                    Crear
                  </Button>
                </form>
              </CardContent>
            ) : null}
          </Card>
        </aside>

        <section className="min-w-0">
          <Card className="min-h-[calc(100svh-154px)]">
            <CardHeader>
              <div className="min-w-0">
                <CardTitle className="truncate">
                  {selectedProfile ? selectedProfile.id : "Selecciona un perfil"}
                </CardTitle>
                <CardDescription className="truncate">
                  {selectedProfile
                    ? selectedProfile.device_name || selectedProfile.name
                    : "Crea o elige un perfil para empezar."}
                </CardDescription>
              </div>
              {selectedProfile ? (
                <CardAction>
                  <Badge variant={draft.active ? "default" : "outline"}>{draft.active ? "activo" : "pausado"}</Badge>
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent>
              {!selectedProfile && !loadingProfile ? (
                <div className="grid min-h-[420px] place-items-center border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Tu siguiente perfil aparecera aqui.
                </div>
              ) : loadingProfile ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-72" />
                  <Skeleton className="h-64 w-full" />
                  <Skeleton className="h-32 w-full" />
                </div>
              ) : (
                <ProfileEditor
                  categories={categories}
                  credentials={credentials}
                  audit={audit}
                  categorySelections={categorySelections}
                  draft={draft}
                  logs={logs}
                  saving={saving}
                  syncing={syncing}
                  setCategorySelections={setCategorySelections}
                  setDraft={setDraft}
                  onCopy={copyText}
                  onDelete={deleteProfile}
                  onRefreshLogs={refreshLogs}
                  onSave={saveProfile}
                  onSync={syncProfile}
                />
              )}
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Pulso</CardTitle>
              <CardDescription>
                {lastLiveAt ? `Actualizado ${formatDate(lastLiveAt)}` : "Esperando actividad"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <CompactStat label="Perfiles" value={status?.database?.profiles ?? 0} />
                <CompactStat label="Activos" value={status?.database?.active_profiles ?? 0} />
                <CompactStat label="Listas" value={status?.database?.cached_blocklists ?? 0} />
                <CompactStat label="Motor" value={status?.adguard?.ok ? "OK" : "Fallo"} />
              </div>
              <div className="flex items-center justify-between border p-3 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  {systemOk ? (
                    <Wifi className="size-4 text-muted-foreground" />
                  ) : (
                    <XCircle className="size-4 text-destructive" />
                  )}
                  <span className="font-medium">Motor DNS</span>
                </div>
                <Badge variant={systemOk ? "default" : "destructive"}>{systemOk ? "OK" : "Fallo"}</Badge>
              </div>
              {status?.sync?.last_error ? (
                <div className="border border-destructive/30 bg-background p-3 text-sm text-destructive">
                  {status.sync.last_error.message}
                </div>
              ) : (
                <div className="border p-3 text-sm text-muted-foreground">Sin errores de sincronizacion.</div>
              )}
              <Button
                type="button"
                variant="outline"
                className="w-full gap-1.5"
                disabled={refreshingBlocklists}
                onClick={() => void refreshBlocklists()}
              >
                {refreshingBlocklists ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Actualizar listas
              </Button>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">Bloqueos recientes</div>
                    <div className="text-xs text-muted-foreground">{selectedId || "Sin perfil"}</div>
                  </div>
                  <Badge variant="secondary">{blockedLogs.length}</Badge>
                </div>
                <RecentBlocks logs={blockedLogs} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Conexion</CardTitle>
              <CardDescription>{credentials?.profile_id || "Sin perfil"}</CardDescription>
            </CardHeader>
            <CardContent>
              <CredentialList credentials={credentials} compact onCopy={copyText} />
            </CardContent>
          </Card>

          <footer className="px-1 text-xs text-muted-foreground">
            Motor DNS basado en AdGuardHome. Consola y perfiles propios.
          </footer>
        </aside>
      </main>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="grid min-h-svh place-items-center bg-background p-6">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <img src="/goat_dns.svg" alt="" className="h-20 w-auto" />
        <Loader2 className="size-4 animate-spin" />
        Preparando consola
      </div>
    </div>
  )
}

function PageBusyOverlay({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-6">
      <div className="flex items-center gap-3 border bg-background px-4 py-3 text-sm">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
        <span className="font-medium">{message}</span>
      </div>
    </div>
  )
}

function LoginScreen({
  sessionKey,
  setSessionKey,
  onSubmit,
}: {
  sessionKey: string
  setSessionKey: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <div className="grid min-h-svh place-items-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-3 flex items-center gap-4">
            <img src="/goat_dns.svg" alt="Goat DNS" className="h-20 w-auto" />
            <div>
              <CardTitle>Consola Segura</CardTitle>
              <CardDescription>Entra una vez; la sesion se protege en este navegador.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3" onSubmit={onSubmit}>
            <div className="grid gap-1.5">
              <Label htmlFor="console-key">Clave de consola</Label>
              <Input
                id="console-key"
                type="password"
                value={sessionKey}
                autoComplete="current-password"
                onChange={(event) => setSessionKey(event.target.value)}
              />
            </div>
            <Button type="submit" className="gap-1.5">
              <KeyRound className="size-4" />
              Entrar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function LoadingRows() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
    </div>
  )
}

function ProfileEditor({
  categories,
  credentials,
  audit,
  categorySelections,
  draft,
  logs,
  saving,
  syncing,
  setCategorySelections,
  setDraft,
  onCopy,
  onDelete,
  onRefreshLogs,
  onSave,
  onSync,
}: {
  categories: Category[]
  credentials: Credentials | null
  audit: ProfileAudit | null
  categorySelections: Record<string, boolean>
  draft: DetailDraft
  logs: QueryLogEntry[]
  saving: boolean
  syncing: boolean
  setCategorySelections: Dispatch<SetStateAction<Record<string, boolean>>>
  setDraft: Dispatch<SetStateAction<DetailDraft>>
  onCopy: (value: string, label: string) => void | Promise<void>
  onDelete: () => void | Promise<void>
  onRefreshLogs: () => void | Promise<void>
  onSave: (event: FormEvent<HTMLFormElement>) => void | Promise<void>
  onSync: () => void | Promise<void>
}) {
  const [preview, setPreview] = useState<CategoryRulePreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [checkDomain, setCheckDomain] = useState("")
  const [checkingDomain, setCheckingDomain] = useState(false)
  const [domainCheck, setDomainCheck] = useState<DomainCheckResult | null>(null)

  async function showCategoryRules(category: Category) {
    setLoadingPreview(true)
    try {
      const data = await apiRequest<CategoryRulePreview>(`/api/blocklists/categories/${category.id}/rules?limit=500`)
      setPreview(data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar el contenido.")
    } finally {
      setLoadingPreview(false)
    }
  }

  function appendManualRule(prefix: "block" | "allow") {
    const example = prefix === "allow" ? "allow ||safe.example.org^" : "block ||example.org^"
    setDraft((current) => ({
      ...current,
      rulesText: current.rulesText.trim() ? `${current.rulesText.trim()}\n${example}` : example,
    }))
  }

  async function runDomainCheck() {
    const profileId = audit?.profile_id || credentials?.profile_id
    const domain = checkDomain.trim()
    if (!profileId || !domain) {
      toast.error("Escribe un dominio para probar.")
      return
    }

    setCheckingDomain(true)
    try {
      const params = new URLSearchParams({ domain, qtype: "A" })
      const result = await apiRequest<DomainCheckResult>(`/api/profiles/${profileId}/check?${params.toString()}`)
      setDomainCheck(result)
      toast.success(result.status === "blocked" ? "El perfil lo bloquearia." : "El perfil lo permitiria.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo probar el dominio.")
    } finally {
      setCheckingDomain(false)
    }
  }

  return (
    <Tabs defaultValue="audit" className="min-w-0">
      <TabsList variant="line" className="mb-4 flex w-full justify-start overflow-x-auto">
        <TabsTrigger value="audit">Auditoria</TabsTrigger>
        <TabsTrigger value="profile">Perfil</TabsTrigger>
        <TabsTrigger value="categories">Filtros</TabsTrigger>
        <TabsTrigger value="rules">Reglas</TabsTrigger>
        <TabsTrigger value="credentials">Conexion</TabsTrigger>
        <TabsTrigger value="logs">Actividad</TabsTrigger>
      </TabsList>

      <form onSubmit={onSave}>
        <TabsContent value="audit" className="space-y-4">
          <ProfileAuditPanel
            audit={audit}
            checkDomain={checkDomain}
            checkingDomain={checkingDomain}
            domainCheck={domainCheck}
            setCheckDomain={setCheckDomain}
            onCheckDomain={runDomainCheck}
          />
        </TabsContent>

        <TabsContent value="profile" className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="detail-name">Nombre</Label>
              <Input
                id="detail-name"
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="detail-device">Dispositivo</Label>
              <Input
                id="detail-device"
                value={draft.deviceName}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    deviceName: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <div className="flex items-center justify-between border p-3">
            <div>
              <div className="font-medium">Disponible para resolver</div>
              <div className="text-xs text-muted-foreground">
                {draft.active ? "El perfil responde con filtros activos." : "El perfil queda pausado."}
              </div>
            </div>
            <Switch
              checked={draft.active}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, active: checked }))}
            />
          </div>
        </TabsContent>

        <TabsContent value="categories" className="space-y-3">
          <div className="grid gap-2 md:grid-cols-2">
            {categories.map((category) => {
              const enabled = categorySelections[category.id] ?? false
              return (
                <div
                  key={category.id}
                  className={cn(
                    "flex min-h-24 items-start gap-3 border bg-background p-3 transition hover:border-primary/50 hover:bg-muted/40",
                    enabled && "border-primary bg-primary/5"
                  )}
                >
                  <Checkbox
                    checked={enabled}
                    onCheckedChange={(checked) =>
                      setCategorySelections((current) => ({
                        ...current,
                        [category.id]: Boolean(checked),
                      }))
                    }
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <span className="block font-medium">{category.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 gap-1 px-2 text-xs"
                        onClick={() => void showCategoryRules(category)}
                      >
                        {loadingPreview && preview?.category.id === category.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <FileText className="size-3" />
                        )}
                        Ver reglas
                      </Button>
                    </div>
                    <span className="block text-xs text-muted-foreground">{category.description}</span>
                    <span className="flex flex-wrap gap-1 pt-1">
                      <Badge variant="secondary">{category.rules_count} reglas</Badge>
                      {(category.blocked_services || []).length > 0 ? (
                        <Badge variant="outline">{(category.blocked_services || []).length} servicios</Badge>
                      ) : null}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          {preview ? <CategoryRulePreviewPanel preview={preview} onClose={() => setPreview(null)} /> : null}
        </TabsContent>

        <TabsContent value="rules" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => appendManualRule("block")}>
              Bloquear dominio
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => appendManualRule("allow")}>
              Permitir dominio
            </Button>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="manual-rules">Reglas manuales</Label>
            <Textarea
              id="manual-rules"
              rows={12}
              spellCheck={false}
              className="font-mono text-xs leading-relaxed"
              placeholder="block ||example.org^"
              value={draft.rulesText}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  rulesText: event.target.value,
                }))
              }
            />
          </div>
        </TabsContent>

        <TabsContent value="credentials" className="space-y-3">
          <CredentialList credentials={credentials} onCopy={onCopy} />
        </TabsContent>

        <TabsContent value="logs" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">{logs.length} entradas</div>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void onRefreshLogs()}>
              <RefreshCw className="size-3.5" />
              Actualizar
            </Button>
          </div>
          <QueryLogTable logs={logs} />
        </TabsContent>

        <Separator className="my-4" />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" className="gap-1.5" disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Guardar
          </Button>
          <Button type="button" variant="outline" className="gap-1.5" disabled={syncing} onClick={() => void onSync()}>
            {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Reaplicar
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive" className="gap-1.5">
                <Trash2 className="size-4" />
                Eliminar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogMedia>
                  <ShieldAlert className="size-5" />
                </AlertDialogMedia>
                <AlertDialogTitle>Eliminar perfil</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta accion elimina el perfil, sus reglas y su filtro sincronizado.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void onDelete()}>
                  Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </form>
    </Tabs>
  )
}

function ProfileAuditPanel({
  audit,
  checkDomain,
  checkingDomain,
  domainCheck,
  setCheckDomain,
  onCheckDomain,
}: {
  audit: ProfileAudit | null
  checkDomain: string
  checkingDomain: boolean
  domainCheck: DomainCheckResult | null
  setCheckDomain: (value: string) => void
  onCheckDomain: () => void | Promise<void>
}) {
  if (!audit) {
    return (
      <div className="border border-dashed p-8 text-center text-sm text-muted-foreground">
        Cargando auditoria del perfil.
      </div>
    )
  }

  const syncOk = audit.sync.status === "ok"
  const activeCategories = audit.categories.filter((category) => category.enabled)
  const visibleServices = audit.native_services.slice(0, 18)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <MetricTile label="Categorias" value={audit.totals.active_categories} icon={FileText} tone="blue" />
        <MetricTile label="Servicios" value={audit.totals.native_services} icon={Shield} tone="green" />
        <MetricTile label="Reglas" value={audit.totals.managed_rules} icon={Database} tone="amber" />
        <MetricTile
          label="Sync"
          value={syncOk ? "OK" : audit.sync.status}
          icon={syncOk ? CheckCircle2 : AlertTriangle}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3 border bg-background p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-medium">Estado operativo</div>
              <div className="text-xs text-muted-foreground">
                {audit.sync.last
                  ? `Ultimo ${audit.sync.last.action} ${formatDate(audit.sync.last.created_at)}`
                  : "Sin sync registrado"}
              </div>
            </div>
            <Badge variant={audit.active ? "default" : "outline"}>{audit.active ? "activo" : "pausado"}</Badge>
          </div>

          <div className="grid gap-2 text-sm md:grid-cols-3">
            <div className="border p-2">
              <div className="text-xs text-muted-foreground">Archivo de reglas</div>
              <div className="mt-1 font-medium">{audit.filter_file ? "generado" : "no requerido"}</div>
            </div>
            <div className="border p-2">
              <div className="text-xs text-muted-foreground">Reglas de listas</div>
              <div className="mt-1 font-medium">{audit.totals.file_rules}</div>
            </div>
            <div className="border p-2">
              <div className="text-xs text-muted-foreground">Reglas manuales</div>
              <div className="mt-1 font-medium">{audit.totals.manual_rules}</div>
            </div>
          </div>

          {audit.sync.last?.status === "error" ? (
            <div className="border border-destructive/30 bg-background p-2 text-sm text-destructive">
              {audit.sync.last.message || "El ultimo sync fallo."}
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="text-sm font-medium">Servicios aplicados</div>
            {visibleServices.length === 0 ? (
              <div className="border border-dashed p-3 text-xs text-muted-foreground">
                Este perfil no usa servicios nativos.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {visibleServices.map((service) => (
                  <Badge key={service} variant="secondary">
                    {service}
                  </Badge>
                ))}
                {audit.native_services.length > visibleServices.length ? (
                  <Badge variant="outline">+{audit.native_services.length - visibleServices.length}</Badge>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3 border bg-background p-3">
          <div>
            <div className="font-medium">Probar dominio</div>
            <div className="text-xs text-muted-foreground">Consulta el motor con el ClientID de este perfil.</div>
          </div>
          <div className="flex gap-2">
            <Input
              value={checkDomain}
              placeholder="youtube.com"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) => setCheckDomain(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  void onCheckDomain()
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              disabled={checkingDomain}
              onClick={() => void onCheckDomain()}
            >
              {checkingDomain ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              Probar
            </Button>
          </div>

          {domainCheck ? (
            <div className="border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{domainCheck.domain}</span>
                <Badge variant={domainCheck.status === "blocked" ? "destructive" : "secondary"}>
                  {domainCheck.status === "blocked" ? "bloqueado" : "permitido"}
                </Badge>
              </div>
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                <div>{domainCheck.service_name || reasonLabel(domainCheck.reason)}</div>
                {domainCheck.rule ? <div className="truncate font-mono">{domainCheck.rule}</div> : null}
                {domainCheck.rules.length > 1 ? <div>{domainCheck.rules.length} reglas coinciden.</div> : null}
              </div>
            </div>
          ) : (
            <div className="border border-dashed p-3 text-xs text-muted-foreground">
              Prueba dominios reales antes de poner el DNS en un dispositivo.
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2 border bg-background p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-medium">Categorias activas</div>
          <Badge variant="secondary">{activeCategories.length}</Badge>
        </div>
        {activeCategories.length === 0 ? (
          <div className="border border-dashed p-3 text-xs text-muted-foreground">
            Sin categorias activas. Solo aplican reglas manuales si existen.
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {activeCategories.map((category) => (
              <div key={category.id} className="border p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{category.name}</span>
                  <Badge variant="outline">{category.blocked_services.length} servicios</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{category.file_rules_count} reglas de archivo</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CategoryRulePreviewPanel({ preview, onClose }: { preview: CategoryRulePreview; onClose: () => void }) {
  const visibleFileRules = preview.file_rules.rules
  const serviceRulesCount = preview.blocked_services.reduce((total, service) => total + service.rules.length, 0)

  return (
    <div className="border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium">{preview.category.name}</div>
          <div className="text-xs text-muted-foreground">{preview.category.description}</div>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Cerrar reglas" onClick={onClose}>
          <XCircle className="size-4" />
        </Button>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="min-w-0 border p-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-sm">
            <span className="font-medium">Reglas de archivo</span>
            <Badge variant="secondary">{preview.file_rules.total}</Badge>
          </div>
          {visibleFileRules.length === 0 ? (
            <div className="border border-dashed p-3 text-xs text-muted-foreground">
              Sin reglas de archivo. Este filtro se aplica con servicios nativos del motor.
            </div>
          ) : (
            <pre className="max-h-72 overflow-auto bg-muted p-3 text-xs leading-relaxed">
              {visibleFileRules.join("\n")}
            </pre>
          )}
          {preview.file_rules.total > visibleFileRules.length ? (
            <div className="mt-2 text-xs text-muted-foreground">
              Mostrando {visibleFileRules.length} de {preview.file_rules.total}.
            </div>
          ) : null}
        </div>

        <div className="min-w-0 border p-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-sm">
            <span className="font-medium">Servicios nativos</span>
            <Badge variant="secondary">{preview.blocked_services.length}</Badge>
          </div>
          {preview.blocked_services.length === 0 ? (
            <div className="border border-dashed p-3 text-xs text-muted-foreground">Sin servicios nativos.</div>
          ) : (
            <div className="max-h-72 space-y-2 overflow-auto">
              {preview.blocked_services.map((service) => (
                <details key={service.id} className="border bg-background p-2 text-xs">
                  <summary className="cursor-pointer font-medium">
                    {service.name}{" "}
                    <span className="text-muted-foreground">
                      ({service.id}, {service.rules.length})
                    </span>
                  </summary>
                  {service.rules.length > 0 ? (
                    <pre className="mt-2 overflow-auto border bg-muted p-2 leading-relaxed">
                      {service.rules.join("\n")}
                    </pre>
                  ) : (
                    <div className="mt-2 text-muted-foreground">El motor no devolvio reglas para este servicio.</div>
                  )}
                </details>
              ))}
            </div>
          )}
          {serviceRulesCount > 0 ? (
            <div className="mt-2 text-xs text-muted-foreground">
              {serviceRulesCount} reglas de servicio disponibles.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function profileSetupUri(credentials: Credentials) {
  const params = new URLSearchParams({
    v: "1",
    profile_id: credentials.profile_id,
    nextdns_dot: `${credentials.profile_id}.dns.nextdns.io`,
    gdns_dot: credentials.dot,
    gdns_doh: credentials.doh,
    gdns_doh_path: credentials.doh_path,
    heartbeat: `/apk/heartbeat/${credentials.profile_id}`,
  })

  return `gdns://profile?${params.toString()}`
}

function profileSetupText(credentials: Credentials) {
  return [
    `Perfil: ${credentials.profile_id}`,
    `NextDNS Private DNS: ${credentials.profile_id}.dns.nextdns.io`,
    `Android Private DNS: ${credentials.dot}`,
    `DoH: ${credentials.doh}`,
    `DoH path: ${credentials.doh_path}`,
    `GDNS APK: ${profileSetupUri(credentials)}`,
  ].join("\n")
}

function CredentialQrBlock({
  title,
  value,
  displayValue,
  icon: Icon,
  copyLabel,
  onCopy,
}: {
  title: string
  value: string
  displayValue?: string
  icon: LucideIcon
  copyLabel: string
  onCopy: (value: string, label: string) => void | Promise<void>
}) {
  const [qrState, setQrState] = useState({
    dataUrl: "",
    failed: false,
    value: "",
  })

  useEffect(() => {
    let cancelled = false

    void toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 224,
      color: {
        dark: "#111111",
        light: "#ffffff",
      },
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setQrState({ dataUrl, failed: false, value })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrState({ dataUrl: "", failed: true, value })
        }
      })

    return () => {
      cancelled = true
    }
  }, [value])

  const qrDataUrl = qrState.value === value ? qrState.dataUrl : ""
  const qrFailed = qrState.value === value && qrState.failed

  return (
    <div className="grid gap-3 border bg-background p-3 sm:grid-cols-[176px_minmax(0,1fr)]">
      <div className="grid aspect-square place-items-center border bg-white p-3">
        {qrDataUrl ? (
          <img src={qrDataUrl} alt={`${title} QR`} className="h-full w-full object-contain" />
        ) : qrFailed ? (
          <QrCode className="size-10 text-neutral-400" />
        ) : (
          <Loader2 className="size-5 animate-spin text-neutral-400" />
        )}
      </div>
      <div className="flex min-w-0 flex-col justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Icon className="size-4 text-primary" />
            {title}
          </div>
          <div className="border bg-muted/40 p-2 font-mono text-xs leading-relaxed break-all">
            {displayValue || value}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit gap-1.5"
          onClick={() => void onCopy(value, copyLabel)}
        >
          <Copy className="size-3.5" />
          Copiar
        </Button>
      </div>
    </div>
  )
}

function CredentialList({
  credentials,
  compact = false,
  onCopy,
}: {
  credentials: Credentials | null
  compact?: boolean
  onCopy: (value: string, label: string) => void | Promise<void>
}) {
  if (!credentials) {
    return (
      <div className="border border-dashed p-6 text-center text-sm text-muted-foreground">Selecciona un perfil.</div>
    )
  }

  const rows = [
    { label: "Android Private DNS", value: credentials.dot, icon: Shield },
    { label: "DoH URL", value: credentials.doh, icon: Server },
    { label: "DoH path", value: credentials.doh_path, icon: Activity },
  ]

  if (compact) {
    return (
      <div className="grid gap-2">
        {rows.map((row) => (
          <div key={row.label} className="flex min-w-0 items-center gap-2 border bg-background p-2.5">
            <row.icon className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-muted-foreground">{row.label}</div>
              <div className="truncate font-mono text-xs">{row.value}</div>
            </div>
            {row.value !== "-" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Copiar ${row.label}`}
                onClick={() => void onCopy(row.value, row.label)}
              >
                <Copy className="size-3.5" />
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    )
  }

  const setupUri = profileSetupUri(credentials)
  const setupText = profileSetupText(credentials)

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 xl:grid-cols-2">
        <CredentialQrBlock
          title="Android Private DNS"
          value={credentials.dot}
          icon={Smartphone}
          copyLabel="Android Private DNS"
          onCopy={onCopy}
        />
        <CredentialQrBlock
          title="GDNS APK"
          value={setupUri}
          displayValue={credentials.profile_id}
          icon={QrCode}
          copyLabel="Payload GDNS APK"
          onCopy={onCopy}
        />
      </div>

      <div className="grid gap-2">
        {rows.map((row) => (
          <div key={row.label} className="flex min-w-0 items-center gap-2 border bg-background p-2.5">
            <row.icon className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-muted-foreground">{row.label}</div>
              <div className="truncate font-mono text-sm">{row.value}</div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Copiar ${row.label}`}
              onClick={() => void onCopy(row.value, row.label)}
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" className="gap-1.5" onClick={() => void onCopy(setupText, "Paquete de conexion")}>
          <Copy className="size-4" />
          Copiar paquete
        </Button>
        <Button
          type="button"
          variant="outline"
          className="gap-1.5"
          onClick={() => void onCopy(setupUri, "Payload GDNS APK")}
        >
          <QrCode className="size-4" />
          Copiar payload APK
        </Button>
      </div>
    </div>
  )
}

function RecentBlocks({ logs }: { logs: QueryLogEntry[] }) {
  if (logs.length === 0) {
    return (
      <div className="border border-dashed p-4 text-center text-sm text-muted-foreground">Sin bloqueos recientes.</div>
    )
  }

  return (
    <div className="space-y-2">
      {logs.slice(0, 6).map((entry, index) => (
        <div key={`${entry.time}-${entry.domain}-${index}`} className="border bg-background p-2 text-xs">
          <div className="truncate font-medium">{entry.domain || "-"}</div>
          <div className="mt-1 flex items-center justify-between gap-2 text-muted-foreground">
            <span>{entry.service_name || reasonLabel(entry.reason)}</span>
            <span>{formatDate(entry.time)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function QueryLogTable({ logs }: { logs: QueryLogEntry[] }) {
  if (logs.length === 0) {
    return (
      <div className="border border-dashed p-8 text-center text-sm text-muted-foreground">
        Sin consultas recientes para este perfil.
      </div>
    )
  }

  return (
    <div className="overflow-hidden border">
      <div className="grid grid-cols-[minmax(180px,1fr)_110px_110px_minmax(160px,260px)] border-b bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground max-lg:hidden">
        <span>Dominio</span>
        <span>Estado</span>
        <span>Tipo</span>
        <span>Detalle</span>
      </div>
      <div className="max-h-[460px] overflow-auto">
        {logs.map((entry, index) => (
          <div
            key={`${entry.time}-${entry.domain}-${index}`}
            className="grid gap-2 border-b px-3 py-2 text-sm last:border-b-0 lg:grid-cols-[minmax(180px,1fr)_110px_110px_minmax(160px,260px)]"
          >
            <div className="min-w-0">
              <div className="truncate font-medium">{entry.domain || "-"}</div>
              <div className="text-xs text-muted-foreground">{formatDate(entry.time)}</div>
            </div>
            <div>
              <Badge variant={entry.status === "blocked" ? "destructive" : "secondary"}>
                {entry.status === "blocked" ? "bloqueada" : "permitida"}
              </Badge>
            </div>
            <div className="text-muted-foreground">{entry.type || "-"}</div>
            <div className="min-w-0 text-xs text-muted-foreground">
              <div className="truncate">{entry.service_name || reasonLabel(entry.reason)}</div>
              {entry.rule ? <div className="truncate font-mono">{entry.rule}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
