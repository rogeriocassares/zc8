/**
 * useEditDevice Hook - Manages edit device modal state at page level
 * Prevents modal from being affected by table re-renders
 */

"use client";

import React, { createContext, useContext, useState } from "react";
import type { Device } from "@/lib/device-context";

interface EditDeviceContextType {
  isOpen: boolean;
  device: Device | null;
  organizationId: string | null;
  openEdit: (device: Device, organizationId: string) => void;
  closeEdit: () => void;
}

const EditDeviceContext = createContext<EditDeviceContextType | undefined>(
  undefined,
);

export function EditDeviceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [device, setDevice] = useState<Device | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  const openEdit = (device: Device, organizationId: string) => {
    setDevice(device);
    setOrganizationId(organizationId);
    setIsOpen(true);
  };

  const closeEdit = () => {
    setIsOpen(false);
    setTimeout(() => {
      setDevice(null);
      setOrganizationId(null);
    }, 300);
  };

  return React.createElement(EditDeviceContext.Provider, { value: { isOpen, device, organizationId, openEdit, closeEdit } }, children);
}

export function useEditDevice() {
  const context = useContext(EditDeviceContext);
  if (context === undefined) {
    throw new Error("useEditDevice must be used within EditDeviceProvider");
  }
  return context;
}
