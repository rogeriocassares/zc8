/**
 * Advanced Device Creation Form
 *
 * Features:
 * - Generates device_id (UUIDv7) and device_key ONLY on form submission
 * - Vendor and model selection with conditional device types
 * - Device types dynamically loaded based on vendor/model combination
 * - 8-byte DevEUI validation for LoRaWAN only
 * - Organization and team selection (team depends on org)
 * - Device tags input with add/remove UI
 * - Full form validation with error messages
 * - Devices always created as active
 * - Only organization members can create devices
 */

"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

interface Vendor {
  id: number;
  name: string;
  description?: string;
}

interface ModelOption {
  name: string;
  device_types?: Array<{
    id: number;
    name: string;
    protocol: string;
    requires_deveui: boolean;
  }>;
}

interface DeviceType {
  id: number;
  name: string;
  protocol: string;
  requires_deveui: boolean;
}

interface Organization {
  id: number;
  name: string;
  description?: string;
  is_public?: boolean;
}

interface Team {
  id: number;
  name: string;
  description?: string;
  is_public?: boolean;
}

interface FormData {
  device_type_id: number | null;
  vendor_id: number | null;
  model: string;
  organization_id: number | null;
  team_id: number | null;
  deveui: string;
  tags: string[];
}

interface CreateDeviceFormProps {
  organizationId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function CreateDeviceForm({
  organizationId,
  onSuccess,
  onCancel,
}: CreateDeviceFormProps) {
  // Form State
  const [formData, setFormData] = useState<FormData>({
    device_type_id: null,
    vendor_id: null,
    model: "",
    organization_id: organizationId ? parseInt(organizationId) : null,
    team_id: null,
    deveui: "",
    tags: [],
  });

  // Dropdown Data
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [availableDeviceTypes, setAvailableDeviceTypes] = useState<
    DeviceType[]
  >([]);

  // UI State
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");

  // Load initial dropdown data
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [vendorsRes, orgsRes] = await Promise.all([
          fetch("/api/vendors"),
          fetch("/api/organizations"),
        ]);

        if (!vendorsRes.ok || !orgsRes.ok) {
          throw new Error("Failed to load form data");
        }

        const vendorsData = await vendorsRes.json();
        const orgsData = await orgsRes.json();

        setVendors(vendorsData.vendors || []);
        setOrganizations(orgsData.organizations || []);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load form data",
        );
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // Load models when vendor changes
  useEffect(() => {
    if (!formData.vendor_id) {
      setModels([]);
      setAvailableDeviceTypes([]);
      setFormData((prev) => ({
        ...prev,
        model: "",
        device_type_id: null,
      }));
      return;
    }

    const loadModels = async () => {
      try {
        const res = await fetch(`/api/vendors/${formData.vendor_id}/models`);
        if (!res.ok) throw new Error("Failed to load models");
        const data = await res.json();
        const modelList = data.models || [];
        setModels(modelList);

        // Reset model and device_type when vendor changes
        setFormData((prev) => ({
          ...prev,
          model: modelList.length > 0 ? modelList[0].name : "",
          device_type_id: null,
        }));
        setAvailableDeviceTypes([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load models");
      }
    };

    loadModels();
  }, [formData.vendor_id]);

  // Load device types when vendor and model change
  useEffect(() => {
    if (!formData.vendor_id || !formData.model) {
      setAvailableDeviceTypes([]);
      setFormData((prev) => ({
        ...prev,
        device_type_id: null,
      }));
      return;
    }

    const loadDeviceTypes = async () => {
      try {
        const res = await fetch(
          `/api/vendors/${formData.vendor_id}/models/${encodeURIComponent(formData.model)}/device-types`,
        );
        if (!res.ok) throw new Error("Failed to load device types");
        const data = await res.json();
        const deviceTypes = data.device_types || [];
        setAvailableDeviceTypes(deviceTypes);

        // Auto-select first device type if available
        if (deviceTypes.length > 0 && !formData.device_type_id) {
          setFormData((prev) => ({
            ...prev,
            device_type_id: deviceTypes[0].id,
          }));
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load device types",
        );
      }
    };

    loadDeviceTypes();
  }, [formData.vendor_id, formData.model]);

  // Load teams when organization changes
  useEffect(() => {
    if (!formData.organization_id) {
      setTeams([]);
      return;
    }

    const loadTeams = async () => {
      try {
        const res = await fetch(
          `/api/organizations/${formData.organization_id}/teams`,
        );
        if (!res.ok) throw new Error("Failed to load teams");
        const data = await res.json();
        setTeams(data.teams || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load teams");
      }
    };

    loadTeams();
  }, [formData.organization_id]);

  // Validate DevEUI: must be 16 hex characters (8 bytes)
  const validateDevEUI = (deveui: string): boolean => {
    const hexRegex = /^[0-9A-Fa-f]{16}$/;
    return hexRegex.test(deveui);
  };

  // Get the selected device type info
  const selectedDeviceType = useMemo(
    () => availableDeviceTypes.find((dt) => dt.id === formData.device_type_id),
    [availableDeviceTypes, formData.device_type_id],
  );

  const requiresDevEUI = selectedDeviceType?.requires_deveui ?? false;

  // Handle form field changes
  const handleInputChange = (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]:
        name === "vendor_id" || name === "organization_id"
          ? value
            ? parseInt(value)
            : null
          : name === "team_id" || name === "device_type_id"
            ? value
              ? parseInt(value)
              : null
            : value,
    }));
  };

  // Handle tag input
  const handleAddTag = () => {
    if (tagInput.trim()) {
      setFormData((prev) => ({
        ...prev,
        tags: [...prev.tags, tagInput.trim()],
      }));
      setTagInput("");
    }
  };

  const handleRemoveTag = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags.filter((_, i) => i !== index),
    }));
  };

  // Generate UUIDv7
  const generateUUID = (): string => {
    const timestamp = Date.now();
    const randomParams = crypto.getRandomValues(new Uint8Array(8));

    const time_hi = (timestamp >> 32) & 0xffffffff;
    const time_mid = (timestamp >> 16) & 0xffff;
    const time_low = (timestamp & 0xffff) | 0x7000;

    const node = Array.from(randomParams)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return `${time_hi.toString(16).padStart(8, "0")}-${time_mid.toString(16).padStart(4, "0")}-${time_low.toString(16).padStart(4, "0")}-${node.slice(0, 4)}-${node.slice(4)}`;
  };

  // Compute device key from UUID
  const computeDeviceKey = (uuid: string): bigint => {
    if (uuid.length !== 36) return 0n;

    let result = 0n;

    const fromHex = (c: string): number => {
      const code = c.charCodeAt(0);
      if (code >= 48 && code <= 57) return code - 48;
      if (code >= 97 && code <= 102) return code - 97 + 10;
      if (code >= 65 && code <= 70) return code - 65 + 10;
      return -1;
    };

    for (let i = 19; i < 23; i++) {
      result = (result << 4n) | BigInt(fromHex(uuid[i]));
    }
    for (let i = 24; i < 36; i++) {
      result = (result << 4n) | BigInt(fromHex(uuid[i]));
    }

    // Mask to 46 bits for signed 64-bit compatibility
    return result & 0x3fffffffffffn;
  };

  // Form submission
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    try {
      setIsSubmitting(true);

      // Validation
      if (!formData.organization_id) {
        throw new Error("Organization is required");
      }
      if (!formData.vendor_id) {
        throw new Error("Vendor is required");
      }
      if (!formData.model) {
        throw new Error("Model is required");
      }
      if (!formData.device_type_id) {
        throw new Error("Device Type is required");
      }

      // Validate DevEUI if required
      if (requiresDevEUI) {
        if (!formData.deveui) {
          throw new Error(
            "Device EUI (DevEUI) is required for this device type",
          );
        }
        if (!validateDevEUI(formData.deveui)) {
          throw new Error(
            "Invalid Device EUI: must be exactly 16 hexadecimal characters (8 bytes)",
          );
        }
      }

      // Generate device_id and device_key NOW (on submission)
      const deviceId = generateUUID();
      const deviceKey = computeDeviceKey(deviceId);

      const tenantId = formData.organization_id;

      const payload = {
        device_type_id: formData.device_type_id,
        deveui: formData.deveui || null,
        vendor_id: formData.vendor_id,
        model: formData.model,
        organization_id: tenantId,
        team_id: formData.team_id,
        tags: formData.tags,
      };

      const res = await fetch(`/api/tenants/${tenantId}/devices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create device");
      }

      setSuccess(
        `Device created successfully! ID: ${data.device.id}, Key: ${data.device.device_key}`,
      );

      // Reset form
      setFormData({
        device_type_id: null,
        vendor_id: null,
        model: "",
        organization_id: organizationId ? parseInt(organizationId) : null,
        team_id: null,
        deveui: "",
        tags: [],
      });

      // Reset device types
      setAvailableDeviceTypes([]);

      // Call onSuccess callback
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error creating device");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <div className="text-slate-300">Loading form data...</div>;
  }

  return (
    <div className="w-full">
      <h2 className="text-xl font-bold text-white mb-4">Create New Device</h2>
      <p className="text-slate-300 mb-6 text-sm">
        Configure a new device by selecting organization, vendor, model, and
        device type. All fields with * are required. Devices are always active
        when created.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 text-red-400 rounded">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-500/10 border border-green-500/50 text-green-400 rounded">
          {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Organization Selection */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Organization *
          </label>
          <select
            name="organization_id"
            value={formData.organization_id || ""}
            onChange={handleInputChange}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 focus:outline-none focus:border-blue-500"
            required
          >
            <option value="">Select an organization</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </div>

        {/* Team Selection */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Team (Optional)
          </label>
          <select
            name="team_id"
            value={formData.team_id || ""}
            onChange={handleInputChange}
            disabled={!formData.organization_id}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 focus:outline-none focus:border-blue-500 disabled:opacity-50"
          >
            <option value="">Select a team</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>

        {/* Vendor Selection */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Vendor *
          </label>
          <select
            name="vendor_id"
            value={formData.vendor_id || ""}
            onChange={handleInputChange}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 focus:outline-none focus:border-blue-500"
            required
          >
            <option value="">Select a vendor</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </select>
        </div>

        {/* Model Selection */}
        {formData.vendor_id && models.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Model *
            </label>
            <select
              name="model"
              value={formData.model}
              onChange={handleInputChange}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 focus:outline-none focus:border-blue-500"
              required
            >
              <option value="">Select a model</option>
              {models.map((model) => (
                <option key={model.name} value={model.name}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Device Type Selection - AFTER Model */}
        {formData.model && availableDeviceTypes.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-3">
              Device Type *
            </label>
            <div className="space-y-2">
              {availableDeviceTypes.map((deviceType) => (
                <label
                  key={deviceType.id}
                  className="flex items-center cursor-pointer"
                >
                  <input
                    type="radio"
                    name="device_type_id"
                    value={deviceType.id}
                    checked={formData.device_type_id === deviceType.id}
                    onChange={handleInputChange}
                    className="mr-3"
                  />
                  <span className="text-slate-300">
                    {deviceType.name}
                    <span className="text-slate-400 text-sm ml-2">
                      ({deviceType.protocol})
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* DevEUI Input - Only if required by device type */}
        {requiresDevEUI && (
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Device EUI (DevEUI) *
            </label>
            <input
              type="text"
              name="deveui"
              value={formData.deveui}
              onChange={handleInputChange}
              placeholder="Enter 8 bytes (16 hex chars), e.g., 70B3D57ED006A1B0"
              className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:border-blue-500 font-mono uppercase bg-slate-700 ${
                formData.deveui && !validateDevEUI(formData.deveui)
                  ? "border-red-500"
                  : formData.deveui && validateDevEUI(formData.deveui)
                    ? "border-green-500"
                    : "border-slate-600"
              }`}
              maxLength={16}
            />
            <p className="mt-1 text-xs text-slate-400">
              8 bytes = 16 hexadecimal characters (0-9, A-F)
            </p>
            {formData.deveui && !validateDevEUI(formData.deveui) && (
              <p className="mt-1 text-xs text-red-400">
                Invalid: Must be exactly 16 hexadecimal characters
              </p>
            )}
            {formData.deveui && validateDevEUI(formData.deveui) && (
              <p className="mt-1 text-xs text-green-400">✓ Valid DevEUI</p>
            )}
          </div>
        )}

        {/* Tags Input */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Tags
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleAddTag()}
              placeholder="Add a tag..."
              className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 focus:outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={handleAddTag}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
            >
              Add
            </button>
          </div>
          {formData.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {formData.tags.map((tag, index) => (
                <span
                  key={index}
                  className="inline-flex items-center gap-2 px-3 py-1 bg-blue-600/30 text-blue-300 rounded-full text-sm border border-blue-500/50"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(index)}
                    className="text-blue-400 hover:text-blue-200"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Submit Button */}
        <div className="flex justify-end gap-2 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-slate-300 bg-slate-700 hover:bg-slate-600 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition-colors font-medium disabled:opacity-50"
          >
            {isSubmitting ? "Creating..." : "Create Device"}
          </button>
        </div>
      </form>
    </div>
  );
}
