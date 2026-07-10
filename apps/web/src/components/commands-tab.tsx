"use client";

/**
 * Commands Tab
 *
 * Send downlink commands to devices and view command history.
 * Commands are dispatched via POST /api/v1/devices/:id/commands and
 * forwarded through NATS → mqtt-subscriber → MQTT broker → device.
 */

import {
  CheckmarkCircle01Icon,
  CpuIcon,
  Loading03Icon,
  SentIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

interface Device {
  id: string;
  device_key: string;
  device_model_name: string;
  vendor_name: string;
  eui: string | null;
  is_active: boolean;
}

interface CommandRecord {
  id: string;
  device_id: string;
  device_key: string;
  command_type: string;
  status: string;
  transport_type: string | null;
  lns_provider_code: string | null;
  error_message: string | null;
  attempts: number;
  max_attempts: number;
  created_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  acked_at: string | null;
}

function statusBadge(status: string) {
  switch (status) {
    case "pending":
      return (
        <Badge
          variant="outline"
          className="text-xs text-yellow-700 border-yellow-400"
        >
          Pending
        </Badge>
      );
    case "dispatched":
      return (
        <Badge
          variant="outline"
          className="text-xs text-blue-700 border-blue-400"
        >
          Dispatched
        </Badge>
      );
    case "delivered":
      return (
        <Badge
          variant="outline"
          className="text-xs text-green-700 border-green-500"
        >
          Delivered
        </Badge>
      );
    case "acked":
      return (
        <Badge
          variant="outline"
          className="text-xs text-green-700 border-green-600 font-semibold"
        >
          Acked
        </Badge>
      );
    case "failed":
      return (
        <Badge
          variant="outline"
          className="text-xs text-destructive border-destructive"
        >
          Failed
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-xs">
          {status}
        </Badge>
      );
  }
}

function formatTs(ts: string | null) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export function CommandsTab({
  token,
  orgId,
}: {
  token: string;
  orgId: number | null;
}) {
  // Devices list
  const [devices, setDevices] = React.useState<Device[]>([]);
  const [loadingDevices, setLoadingDevices] = React.useState(false);
  const devicesLoaded = React.useRef(false);

  // Form state
  const [selectedDeviceId, setSelectedDeviceId] = React.useState<string>("");
  const [fPort, setFPort] = React.useState<string>("1");
  const [confirmed, setConfirmed] = React.useState(false);
  const [hexData, setHexData] = React.useState<string>("");

  // Submission state
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const [lastResult, setLastResult] = React.useState<{
    command_id: string;
    status: string;
    formatter_code: string;
  } | null>(null);

  // History state
  const [history, setHistory] = React.useState<CommandRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = React.useState(false);

  // Load devices once
  React.useEffect(() => {
    if (devicesLoaded.current || !token) return;
    devicesLoaded.current = true;
    setLoadingDevices(true);
    const qs = orgId ? `?org_id=${orgId}` : "";
    fetch(`${API}/api/v1/devices${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (json.success) setDevices(json.data as Device[]);
      })
      .catch(() => {})
      .finally(() => setLoadingDevices(false));
  }, [token, orgId]);

  // Load command history when device changes
  React.useEffect(() => {
    if (!selectedDeviceId || !token) {
      setHistory([]);
      return;
    }
    setLoadingHistory(true);
    fetch(`${API}/api/v1/commands?device_id=${selectedDeviceId}&limit=20`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) return;
        const json = await r.json();
        if (json.success) setHistory(json.data as CommandRecord[]);
      })
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, [selectedDeviceId, token]);

  // Validate hex string
  function isValidHex(s: string) {
    return s === "" || (/^[0-9A-Fa-f]*$/.test(s) && s.length % 2 === 0);
  }

  async function handleSendCommand() {
    if (!selectedDeviceId) return;
    const portNum = Number(fPort);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 223) {
      setSendError("fPort must be between 1 and 223.");
      return;
    }
    if (!isValidHex(hexData)) {
      setSendError(
        "Data must be a valid hex string (even number of hex chars).",
      );
      return;
    }

    setSending(true);
    setSendError(null);
    setLastResult(null);

    try {
      const r = await fetch(
        `${API}/api/v1/devices/${selectedDeviceId}/commands`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            command_type: "downlink_raw",
            payload: {
              fPort: portNum,
              confirmed,
              data: hexData,
            },
          }),
        },
      );
      const json = await r.json();
      if (!r.ok || !json.success) throw new Error(json.error ?? "Send failed");

      setLastResult(json.data);

      // Refresh history
      const hr = await fetch(
        `${API}/api/v1/commands?device_id=${selectedDeviceId}&limit=20`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const hjson = await hr.json();
      if (hr.ok && hjson.success) setHistory(hjson.data as CommandRecord[]);
    } catch (e: unknown) {
      setSendError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);

  return (
    <div className="space-y-6">
      {/* Command Form */}
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <HugeiconsIcon
            icon={CpuIcon}
            size={16}
            className="text-muted-foreground"
          />
          <h2 className="text-base font-semibold">Send Downlink Command</h2>
          <Badge variant="secondary" className="text-xs ml-auto">
            ChirpStack v4 / LoRaWAN
          </Badge>
        </div>

        {/* Device selector */}
        <div className="grid gap-1.5">
          <Label>Device *</Label>
          <Select
            value={selectedDeviceId}
            onValueChange={(v) => {
              setSelectedDeviceId(v);
              setSendError(null);
              setLastResult(null);
            }}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  loadingDevices ? "Loading devices…" : "Select a device…"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {devices.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  <span className="font-mono text-xs">{d.device_key}</span>
                  {d.eui && (
                    <span className="text-muted-foreground ml-2 text-xs">
                      {d.eui}
                    </span>
                  )}
                  <span className="text-muted-foreground ml-2 text-xs">
                    {d.vendor_name} / {d.device_model_name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedDevice && (
            <p className="text-xs text-muted-foreground">
              Key:{" "}
              <span className="font-mono">{selectedDevice.device_key}</span>
              {selectedDevice.eui && (
                <>
                  {" · EUI: "}
                  <span className="font-mono">{selectedDevice.eui}</span>
                </>
              )}
            </p>
          )}
        </div>

        {/* fPort */}
        <div className="grid gap-1.5">
          <Label>fPort *</Label>
          <Input
            type="number"
            min={1}
            max={223}
            placeholder="1"
            value={fPort}
            onChange={(e) => setFPort(e.target.value)}
            className="w-32"
          />
          <p className="text-xs text-muted-foreground">
            LoRaWAN application port (1–223)
          </p>
        </div>

        {/* Data (hex) */}
        <div className="grid gap-1.5">
          <Label>Data (hex)</Label>
          <Input
            placeholder="e.g. 0102FF"
            value={hexData}
            onChange={(e) => setHexData(e.target.value.toUpperCase())}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Hex-encoded payload bytes. Leave blank to send an empty payload.
          </p>
        </div>

        {/* Confirmed */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="cmd-confirmed"
            checked={confirmed}
            onCheckedChange={(v) => setConfirmed(v === true)}
          />
          <Label htmlFor="cmd-confirmed" className="cursor-pointer">
            Confirmed downlink
          </Label>
          <span className="text-xs text-muted-foreground">
            (request ACK from device)
          </span>
        </div>

        {sendError && <p className="text-sm text-destructive">{sendError}</p>}

        {lastResult && (
          <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
            <HugeiconsIcon icon={CheckmarkCircle01Icon} size={15} />
            <span>
              Dispatched — command ID:{" "}
              <span className="font-mono text-xs">{lastResult.command_id}</span>
              {lastResult.formatter_code && (
                <span className="ml-2 text-muted-foreground">
                  via {lastResult.formatter_code}
                </span>
              )}
            </span>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button
            onClick={handleSendCommand}
            disabled={sending || !selectedDeviceId}
          >
            {sending ? (
              <HugeiconsIcon
                icon={Loading03Icon}
                size={14}
                className="mr-2 animate-spin"
              />
            ) : (
              <HugeiconsIcon icon={SentIcon} size={14} className="mr-2" />
            )}
            Send Command
          </Button>
        </div>
      </div>

      {/* Command History */}
      {selectedDeviceId && (
        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between px-5 py-3 border-b">
            <h2 className="text-sm font-semibold">Command History</h2>
            {loadingHistory && (
              <HugeiconsIcon
                icon={Loading03Icon}
                size={14}
                className="animate-spin text-muted-foreground"
              />
            )}
          </div>
          {history.length === 0 && !loadingHistory ? (
            <p className="text-sm text-muted-foreground px-5 py-4">
              No commands sent to this device yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Transport</TableHead>
                    <TableHead className="text-xs">Sent at</TableHead>
                    <TableHead className="text-xs">Dispatched at</TableHead>
                    <TableHead className="text-xs">Command ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((cmd) => (
                    <TableRow key={cmd.id}>
                      <TableCell>{statusBadge(cmd.status)}</TableCell>
                      <TableCell className="text-xs font-mono">
                        {cmd.command_type}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {cmd.transport_type ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {formatTs(cmd.created_at)}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {formatTs(cmd.dispatched_at)}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {cmd.id.slice(0, 8)}…
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
