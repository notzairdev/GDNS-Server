import { useEffect, useMemo, useState } from "react"
import type { FormEvent } from "react"
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Database,
  FileText,
  KeyRound,
  Loader2,
  Moon,
  Plus,
  RefreshCw,
  Save,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  Wifi,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

import {
  apiRequest,
  type Category,
  type Credentials,
  type Profile,
  type ProfileSummary,
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
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

const tokenStorageKey = "gdns.apiToken"

type DetailDraft = {
  name: string
  deviceName: string
  active: boolean
  rulesText: string
}

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

function statusTone(ok?: boolean) {
  return ok ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-amber-700 bg-amber-50 border-amber-200"
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string
  value: string | number
  icon: typeof Activity
  tone?: "neutral" | "green" | "blue" | "amber"
}) {
  const tones = {
    neutral: "bg-muted text-foreground",
    green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    blue: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  }

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className={cn("grid size-7 place-items-center rounded-md", tones[tone])}>
          <Icon className="size-3.5" />
        </span>
        {label}
      </div>
      <div className="mt-2 truncate text-xl font-semibold">{value}</div>
    </div>
  )
}

function LoadingRows() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  )
}

function App() {
  const { theme, setTheme } = useTheme()
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenStorageKey) || "")
  const [tokenInput, setTokenInput] = useState(token)
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [status, setStatus] = useState<Status | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null)
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [logs, setLogs] = useState<QueryLogEntry[]>([])
  const [draft, setDraft] = useState<DetailDraft>(emptyDraft)
  const [categorySelections, setCategorySelections] = useState<Record<string, boolean>>({})
  const [loadingDashboard, setLoadingDashboard] = useState(false)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [refreshingBlocklists, setRefreshingBlocklists] = useState(false)

  const selectedSummary = useMemo(
    () => profiles.find((profile) => profile.id === selectedId) || null,
    [profiles, selectedId]
  )

  async function request<T>(path: string, options = {}) {
    return apiRequest<T>(token, path, options)
  }

  function hydrateDraft(profile: Profile) {
    setDraft({
      name: profile.name || "",
      deviceName: profile.device_name || "",
      active: profile.active,
      rulesText: rulesToTextarea(profile.rules || []),
    })

    setCategorySelections(
      Object.fromEntries(profile.categories.map((entry) => [entry.category, entry.enabled]))
    )
  }

  async function loadProfile(profileId: string, nextToken = token) {
    setLoadingProfile(true)
    try {
      const [profileData, credentialsData, logsData] = await Promise.all([
        apiRequest<{ profile: Profile }>(nextToken, `/api/profiles/${profileId}`),
        apiRequest<Credentials>(nextToken, `/api/profiles/${profileId}/credentials`),
        apiRequest<{ logs: QueryLogEntry[] }>(nextToken, `/api/profiles/${profileId}/logs?limit=120`),
      ])

      setSelectedId(profileId)
      setSelectedProfile(profileData.profile)
      setCredentials(credentialsData)
      setLogs(logsData.logs)
      hydrateDraft(profileData.profile)
    } finally {
      setLoadingProfile(false)
    }
  }

  async function loadDashboard(nextToken = token, nextSelectedId = selectedId) {
    if (!nextToken) {
      toast.error("Guarda el API token.")
      return
    }

    setLoadingDashboard(true)
    try {
      const [profilesData, categoriesData, statusData] = await Promise.all([
        apiRequest<{ profiles: ProfileSummary[] }>(nextToken, "/api/profiles"),
        apiRequest<{ categories: Category[] }>(nextToken, "/api/blocklists/categories"),
        apiRequest<Status>(nextToken, "/api/status"),
      ])

      setProfiles(profilesData.profiles)
      setCategories(categoriesData.categories)
      setStatus(statusData)

      const targetId =
        nextSelectedId && profilesData.profiles.some((profile) => profile.id === nextSelectedId)
          ? nextSelectedId
          : profilesData.profiles[0]?.id || null

      if (targetId) {
        await loadProfile(targetId, nextToken)
      } else {
        setSelectedId(null)
        setSelectedProfile(null)
        setCredentials(null)
        setLogs([])
        setDraft(emptyDraft)
        setCategorySelections({})
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar GDNS.")
    } finally {
      setLoadingDashboard(false)
    }
  }

  async function refreshLogs() {
    if (!selectedId) {
      return
    }

    try {
      const logsData = await request<{ logs: QueryLogEntry[] }>(
        `/api/profiles/${selectedId}/logs?limit=120`
      )
      setLogs(logsData.logs)
      toast.success("Logs actualizados.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar logs.")
    }
  }

  async function saveToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextToken = tokenInput.trim()
    setToken(nextToken)
    sessionStorage.setItem(tokenStorageKey, nextToken)
    await loadDashboard(nextToken, selectedId)
  }

  async function createProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const id = String(form.get("id") || "").toLowerCase().trim()
    const name = String(form.get("name") || "").trim()
    const deviceName = String(form.get("device_name") || "").trim()

    try {
      const created = await request<{ profile: Profile }>("/api/profiles", {
        method: "POST",
        body: {
          id,
          name,
          device_name: deviceName,
        },
      })
      event.currentTarget.reset()
      toast.success("Perfil creado.")
      await loadDashboard(token, created.profile.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear el perfil.")
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedProfile) {
      return
    }

    setSaving(true)
    try {
      await request(`/api/profiles/${selectedProfile.id}`, {
        method: "PUT",
        body: {
          name: draft.name,
          device_name: draft.deviceName,
          active: draft.active,
          categories: categorySelections,
          rules: ruleRowsFromTextarea(draft.rulesText),
        },
      })
      toast.success("Perfil guardado.")
      await loadDashboard(token, selectedProfile.id)
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
      await request(`/api/profiles/${selectedProfile.id}/sync`, { method: "POST" })
      toast.success("Perfil sincronizado.")
      await loadDashboard(token, selectedProfile.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo sincronizar.")
    } finally {
      setSyncing(false)
    }
  }

  async function deleteProfile() {
    if (!selectedProfile) {
      return
    }

    try {
      await request(`/api/profiles/${selectedProfile.id}`, { method: "DELETE" })
      toast.success("Perfil eliminado.")
      await loadDashboard(token, null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar.")
    }
  }

  async function refreshBlocklists() {
    setRefreshingBlocklists(true)
    try {
      await request("/api/blocklists/refresh", {
        method: "POST",
        body: {},
      })
      toast.success("Blocklists actualizadas.")
      await loadDashboard(token, selectedId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron refrescar blocklists.")
    } finally {
      setRefreshingBlocklists(false)
    }
  }

  async function copyText(value: string, label: string) {
    await navigator.clipboard.writeText(value)
    toast.success(`${label} copiado.`)
  }

  useEffect(() => {
    if (token) {
      const timeout = window.setTimeout(() => {
        void loadDashboard(token, null)
      }, 0)

      return () => window.clearTimeout(timeout)
    }

    return undefined
    // Initial load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const systemOk = status?.ok === true

  return (
    <div className="min-h-svh bg-muted/40 text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1680px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
              GD
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-semibold">GDNS</h1>
                <Badge
                  variant="outline"
                  className={cn("gap-1 border", statusTone(systemOk))}
                >
                  {systemOk ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
                  {status?.status || "sin estado"}
                </Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {selectedSummary
                  ? `${selectedSummary.id} activo en consola`
                  : "Consola de perfiles DNS"}
              </p>
            </div>
          </div>

          <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={saveToken}>
            <div className="grid min-w-0 gap-1 sm:w-80">
              <Label htmlFor="api-token" className="text-xs">
                API token
              </Label>
              <Input
                id="api-token"
                type="password"
                autoComplete="current-password"
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="gap-1.5">
                <KeyRound className="size-4" />
                Guardar
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Actualizar dashboard"
                onClick={() => void loadDashboard()}
              >
                <RefreshCw className={cn("size-4", loadingDashboard && "animate-spin")} />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Cambiar tema"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </Button>
            </div>
          </form>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1680px] gap-4 p-4 lg:grid-cols-[300px_minmax(0,1fr)_320px] 2xl:grid-cols-[320px_minmax(0,1fr)_340px]">
        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Nuevo perfil</CardTitle>
              <CardDescription>ID compatible con NextDNS.</CardDescription>
            </CardHeader>
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
                <Button type="submit" className="gap-1.5">
                  <Plus className="size-4" />
                  Crear perfil
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Perfiles</CardTitle>
              <CardAction>
                <Badge variant="secondary">{profiles.length}</Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              {loadingDashboard && profiles.length === 0 ? (
                <LoadingRows />
              ) : profiles.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Sin perfiles.
                </div>
              ) : (
                <div className="grid gap-2">
                  {profiles.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      className={cn(
                        "grid w-full gap-1 rounded-lg border bg-background p-3 text-left transition hover:border-primary/40 hover:bg-muted/50",
                        profile.id === selectedId && "border-primary/50 bg-primary/5"
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
        </aside>

        <section className="min-w-0">
          <Card className="min-h-[calc(100svh-112px)]">
            <CardHeader>
              <div className="min-w-0">
                <CardTitle className="truncate">
                  {selectedProfile ? selectedProfile.id : "Detalle del perfil"}
                </CardTitle>
                <CardDescription className="truncate">
                  {selectedProfile
                    ? selectedProfile.device_name || selectedProfile.name
                    : "Selecciona un perfil para editarlo."}
                </CardDescription>
              </div>
              {selectedProfile ? (
                <CardAction>
                  <Badge variant={draft.active ? "default" : "outline"}>
                    {draft.active ? "activo" : "pausado"}
                  </Badge>
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent>
              {!selectedProfile && !loadingProfile ? (
                <div className="grid min-h-[420px] place-items-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Selecciona o crea un perfil.
                </div>
              ) : loadingProfile ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-72 rounded-lg" />
                  <Skeleton className="h-64 w-full rounded-lg" />
                  <Skeleton className="h-32 w-full rounded-lg" />
                </div>
              ) : (
                <Tabs defaultValue="profile" className="min-w-0">
                  <TabsList variant="line" className="mb-4 flex w-full justify-start overflow-x-auto">
                    <TabsTrigger value="profile">Perfil</TabsTrigger>
                    <TabsTrigger value="categories">Categorias</TabsTrigger>
                    <TabsTrigger value="rules">Reglas</TabsTrigger>
                    <TabsTrigger value="credentials">Credenciales</TabsTrigger>
                    <TabsTrigger value="logs">Logs</TabsTrigger>
                  </TabsList>

                  <form onSubmit={saveProfile}>
                    <TabsContent value="profile" className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="grid gap-1.5">
                          <Label htmlFor="detail-name">Nombre</Label>
                          <Input
                            id="detail-name"
                            value={draft.name}
                            onChange={(event) =>
                              setDraft((current) => ({ ...current, name: event.target.value }))
                            }
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label htmlFor="detail-device">Dispositivo</Label>
                          <Input
                            id="detail-device"
                            value={draft.deviceName}
                            onChange={(event) =>
                              setDraft((current) => ({ ...current, deviceName: event.target.value }))
                            }
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                          <div className="font-medium">Estado</div>
                          <div className="text-xs text-muted-foreground">
                            {draft.active ? "Filtrado activo" : "Perfil pausado"}
                          </div>
                        </div>
                        <Switch
                          checked={draft.active}
                          onCheckedChange={(checked) =>
                            setDraft((current) => ({ ...current, active: checked }))
                          }
                        />
                      </div>
                    </TabsContent>

                    <TabsContent value="categories" className="space-y-3">
                      <div className="grid gap-2 md:grid-cols-2">
                        {categories.map((category) => {
                          const enabled = categorySelections[category.id] ?? false
                          return (
                            <label
                              key={category.id}
                              className={cn(
                                "flex min-h-24 cursor-pointer items-start gap-3 rounded-lg border p-3 transition hover:bg-muted/50",
                                enabled && "border-primary/50 bg-primary/5"
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
                              <span className="min-w-0 space-y-1">
                                <span className="block font-medium">{category.name}</span>
                                <span className="block text-xs text-muted-foreground">
                                  {category.description}
                                </span>
                                <span className="flex flex-wrap gap-1 pt-1">
                                  <Badge variant="secondary">{category.rules_count} reglas</Badge>
                                  {(category.blocked_services || []).length > 0 ? (
                                    <Badge variant="outline">
                                      {(category.blocked_services || []).length} servicios
                                    </Badge>
                                  ) : null}
                                </span>
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    </TabsContent>

                    <TabsContent value="rules" className="space-y-3">
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
                            setDraft((current) => ({ ...current, rulesText: event.target.value }))
                          }
                        />
                      </div>
                    </TabsContent>

                    <TabsContent value="credentials" className="space-y-3">
                      <CredentialList credentials={credentials} onCopy={copyText} />
                    </TabsContent>

                    <TabsContent value="logs" className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm text-muted-foreground">{logs.length} entradas</div>
                        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void refreshLogs()}>
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
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-1.5"
                        disabled={syncing}
                        onClick={() => void syncProfile()}
                      >
                        {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                        Sincronizar
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
                              Esta accion elimina el cliente, sus reglas y su filtro sincronizado.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={() => void deleteProfile()}>
                              Eliminar
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </form>
                </Tabs>
              )}
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Estado</CardTitle>
              <CardAction>
                <Badge variant={systemOk ? "default" : "destructive"}>
                  {systemOk ? "ok" : "degraded"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <MetricCard label="Perfiles" value={status?.database?.profiles ?? 0} icon={Database} tone="blue" />
                <MetricCard label="Activos" value={status?.database?.active_profiles ?? 0} icon={ShieldCheck} tone="green" />
                <MetricCard label="Blocklists" value={status?.database?.cached_blocklists ?? 0} icon={FileText} tone="amber" />
                <MetricCard label="AGH" value={status?.adguard?.ok ? "ok" : "fallo"} icon={Server} />
              </div>
              <div className="rounded-lg border p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  {status?.adguard?.ok ? <Wifi className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-destructive" />}
                  AdGuardHome
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {status?.adguard?.version || status?.adguard?.error || "sin version"}
                </div>
              </div>
              {status?.sync?.last_error ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {status.sync.last_error.message}
                </div>
              ) : (
                <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                  Sin errores de sync.
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                className="w-full gap-1.5"
                disabled={refreshingBlocklists}
                onClick={() => void refreshBlocklists()}
              >
                {refreshingBlocklists ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Refrescar blocklists
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Credenciales</CardTitle>
              <CardDescription>{credentials?.profile_id || "Sin perfil"}</CardDescription>
            </CardHeader>
            <CardContent>
              <CredentialList credentials={credentials} compact onCopy={copyText} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ultimos bloqueos</CardTitle>
              <CardDescription>{selectedId || "Sin perfil"}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {logs.filter((entry) => entry.status === "blocked").slice(0, 5).map((entry, index) => (
                  <div key={`${entry.time}-${entry.domain}-${index}`} className="rounded-lg border p-2 text-xs">
                    <div className="truncate font-medium">{entry.domain || "-"}</div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-muted-foreground">
                      <span>{reasonLabel(entry.reason)}</span>
                      <span>{formatDate(entry.time)}</span>
                    </div>
                  </div>
                ))}
                {logs.filter((entry) => entry.status === "blocked").length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                    Sin bloqueos recientes.
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </aside>
      </main>
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
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Selecciona un perfil.
      </div>
    )
  }

  const rows = [
    { label: "DoT", value: credentials.dot, icon: Shield },
    { label: "DoH", value: credentials.doh, icon: Server },
    { label: "DoH path", value: credentials.doh_path, icon: Activity },
    { label: "DNS plano", value: credentials.plain_dns || "-", icon: Smartphone },
  ]

  return (
    <div className="grid gap-2">
      {rows.map((row) => (
        <div key={row.label} className="flex min-w-0 items-center gap-2 rounded-lg border p-2.5">
          <row.icon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-muted-foreground">{row.label}</div>
            <div className={cn("truncate font-mono text-xs", !compact && "text-sm")}>{row.value}</div>
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

function QueryLogTable({ logs }: { logs: QueryLogEntry[] }) {
  if (logs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Sin consultas recientes para este perfil.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border">
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
