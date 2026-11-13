/* =========================================================
   FOUNDEV — ADMIN MY PROJECTS
   File: admin-my-projects.js

   Features:
   - Load institution-owned project purchases
   - Search projects
   - Filter by access/payment status
   - Summary statistics
   - Pagination
   - Loading, empty and error states
   - Refresh and retry
   - Safe DOM rendering
========================================================= */

"use strict";

(() => {
    const CONFIG = {
        // Create this endpoint in institute-users/api/admin/
        apiUrl: "api/admin/my-projects.php",
        pageSize: 6,
        expiringWithinDays: 30
    };

    const state = {
        projects: [],
        filteredProjects: [],
        currentPage: 1,
        search: "",
        status: "all",
        loading: false,
        requestController: null
    };

    const $ = (selector) => document.querySelector(selector);

    const elements = {
        institutionName: $("#institution-name"),
        adminName: $("#admin-name"),
        adminEmail: $("#admin-email"),
        adminInitial: $("#admin-initial"),
        welcomeAdminName: $("#welcome-admin-name"),
        welcomeDate: $("#welcome-date"),
        dashboardDate: $("#dashboard-date"),
        currentYear: $("#current-year"),

        systemStatus: $("#system-status"),
        systemStatusText: $("#system-status-text"),

        notice: $("#projects-notice"),
        noticeText: $("#projects-notice-text"),
        dismissNotice: $("#dismiss-notice"),

        totalProjects: $("#total-projects"),
        activeProjects: $("#active-projects"),
        expiringProjects: $("#expiring-projects"),
        pendingProjects: $("#pending-projects"),

        search: $("#project-search"),
        statusFilter: $("#project-status-filter"),
        refreshButton: $("#refresh-projects"),

        loading: $("#projects-loading"),
        grid: $("#my-projects-grid"),
        empty: $("#projects-empty"),
        emptyTitle: $("#projects-empty-title"),
        emptyDescription: $("#projects-empty-description"),

        error: $("#projects-error"),
        errorText: $("#projects-error-text"),
        retryButton: $("#retry-projects"),

        pagination: $("#projects-pagination"),
        paginationInfo: $("#projects-pagination-info"),
        previousPage: $("#projects-previous-page"),
        nextPage: $("#projects-next-page")
    };

    /* -----------------------------------------------------
       GENERAL HELPERS
    ----------------------------------------------------- */

    function setText(element, value) {
        if (element) {
            element.textContent = value ?? "";
        }
    }

    function show(element, visible) {
        if (element) {
            element.hidden = !visible;
        }
    }

    function formatCurrency(value, currency = "INR") {
        const amount = Number(value);

        if (!Number.isFinite(amount)) {
            return "—";
        }

        try {
            return new Intl.NumberFormat("en-IN", {
                style: "currency",
                currency,
                maximumFractionDigits: 2
            }).format(amount);
        } catch {
            return `${currency} ${amount.toFixed(2)}`;
        }
    }

    function formatDate(value) {
        if (!value) {
            return "Not available";
        }

        // Interpret a SQL DATE or DATETIME without timezone information
        // in the browser's local timezone.
        const raw = String(value);
        const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw)
            ? `${raw}T00:00:00`
            : raw.replace(" ", "T");

        const date = new Date(normalized);

        if (Number.isNaN(date.getTime())) {
            return "Not available";
        }

        return new Intl.DateTimeFormat("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric"
        }).format(date);
    }

    function daysUntil(value) {
        if (!value) {
            return null;
        }

        const date = new Date(String(value).replace(" ", "T"));

        if (Number.isNaN(date.getTime())) {
            return null;
        }

        return Math.ceil(
            (date.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );
    }

    function escapeText(value) {
        return String(value ?? "");
    }

    function normalizeStatus(project) {
        const raw = String(
            project.display_status ??
            project.access_status ??
            project.payment_status ??
            project.status ??
            ""
        ).trim().toLowerCase();

        if (["paid", "active", "approved", "accessible"].includes(raw)) {
            const remaining = daysUntil(project.access_expires_at);

            if (remaining !== null && remaining < 0) {
                return "expired";
            }

            if (
                remaining !== null &&
                remaining <= CONFIG.expiringWithinDays
            ) {
                return "expiring";
            }

            return "active";
        }

        if (["pending", "created", "processing"].includes(raw)) {
            return "pending";
        }

        if (["expired", "access_expired"].includes(raw)) {
            return "expired";
        }

        if (["failed", "payment_failed"].includes(raw)) {
            return "failed";
        }

        if (["cancelled", "canceled"].includes(raw)) {
            return "cancelled";
        }

        if (["refunded"].includes(raw)) {
            return "refunded";
        }

        return raw || "unknown";
    }

    function statusLabel(status) {
        const labels = {
            active: "Active",
            expiring: "Expiring soon",
            pending: "Payment pending",
            expired: "Expired",
            failed: "Payment failed",
            cancelled: "Cancelled",
            refunded: "Refunded",
            unknown: "Status unavailable"
        };

        return labels[status] || status.replace(/_/g, " ");
    }

    function statusClass(status) {
        const classes = {
            active: "project-status-active",
            expiring: "project-status-expiring",
            pending: "project-status-pending",
            expired: "project-status-expired",
            failed: "project-status-failed",
            cancelled: "project-status-cancelled",
            refunded: "project-status-cancelled",
            unknown: "project-status-cancelled"
        };

        return classes[status] || "project-status-cancelled";
    }

    function createElement(tag, className, text) {
        const element = document.createElement(tag);

        if (className) {
            element.className = className;
        }

        if (text !== undefined) {
            element.textContent = text;
        }

        return element;
    }

    function createMetaItem(label, value) {
        const wrapper = createElement("span", "project-meta-item");
        const labelElement = createElement("span", "", label);
        const valueElement = createElement("strong", "", value);

        wrapper.append(labelElement, valueElement);

        return wrapper;
    }

    function showNotice(message) {
        setText(elements.noticeText, message);
        show(elements.notice, true);
    }

    function hideNotice() {
        show(elements.notice, false);
    }

    function setSystemStatus(online, message) {
        if (!elements.systemStatus) {
            return;
        }

        elements.systemStatus.classList.toggle("is-online", online);
        elements.systemStatus.classList.toggle("is-offline", !online);

        setText(elements.systemStatusText, message);
    }

    function setLoading(loading) {
        state.loading = loading;

        show(elements.loading, loading);

        if (elements.refreshButton) {
            elements.refreshButton.disabled = loading;
            elements.refreshButton.classList.toggle("is-loading", loading);
        }

        if (elements.grid) {
            elements.grid.setAttribute("aria-busy", String(loading));
        }
    }

    function setError(message) {
        setText(
            elements.errorText,
            message || "We couldn't load your projects. Please try again."
        );

        show(elements.error, true);
    }

    function clearError() {
        show(elements.error, false);
    }

    /* -----------------------------------------------------
       PAGE HEADER
    ----------------------------------------------------- */

    function initializeHeader() {
        const now = new Date();

        const today = new Intl.DateTimeFormat("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric"
        }).format(now);

        setText(elements.dashboardDate, today);
        setText(elements.welcomeDate, today);
        setText(elements.currentYear, now.getFullYear());

        if (elements.dismissNotice) {
            elements.dismissNotice.addEventListener("click", hideNotice);
        }

        /*
         * Shared account and sidebar interactions remain in
         * institute-layout.js. This page only provides safe
         * fallback labels when profile data has not been loaded.
         */
        if (
            elements.adminName &&
            !elements.adminName.textContent.trim()
        ) {
            setText(elements.adminName, "Administrator");
        }
    }

    /* -----------------------------------------------------
       API
    ----------------------------------------------------- */

    async function requestProjects() {
        if (state.requestController) {
            state.requestController.abort();
        }

        const controller = new AbortController();
        state.requestController = controller;

        setLoading(true);
        clearError();
        hideNotice();

        try {
            const response = await fetch(CONFIG.apiUrl, {
                method: "GET",
                credentials: "same-origin",
                headers: {
                    "Accept": "application/json"
                },
                cache: "no-store",
                signal: controller.signal
            });

            const contentType = response.headers.get("content-type") || "";

            if (!contentType.includes("application/json")) {
                throw new Error(
                    response.status === 401 || response.status === 403
                        ? "Your session may have expired. Sign in again."
                        : "The projects API did not return JSON. Check the API URL and PHP errors."
                );
            }

            const data = await response.json();

            if (!response.ok || data.success !== true) {
                throw new Error(
                    data.message ||
                    `Unable to load projects (HTTP ${response.status}).`
                );
            }

            if (!Array.isArray(data.projects)) {
                throw new Error(
                    "The projects API response must contain a projects array."
                );
            }

            state.projects = data.projects.map((project) => ({
                ...project,
                _status: normalizeStatus(project)
            }));

            state.currentPage = 1;

            setSystemStatus(true, "Connected");

            renderAll();

        } catch (error) {
            if (error.name === "AbortError") {
                return;
            }

            console.error("[Foundev My Projects]", error);

            setSystemStatus(false, "Connection issue");

            state.projects = [];
            state.filteredProjects = [];

            updateStats();
            renderProjectCards();
            updatePagination();

            show(elements.empty, false);
            setError(error.message);
        } finally {
            if (state.requestController === controller) {
                state.requestController = null;
                setLoading(false);
            }
        }
    }

    /* -----------------------------------------------------
       SUMMARY STATISTICS
    ----------------------------------------------------- */

    function updateStats() {
        const projects = state.projects;

        const activeCount = projects.filter(
            (project) => project._status === "active"
        ).length;

        const expiringCount = projects.filter(
            (project) => project._status === "expiring"
        ).length;

        const pendingCount = projects.filter(
            (project) => project._status === "pending"
        ).length;

        setText(elements.totalProjects, projects.length);
        setText(elements.activeProjects, activeCount);
        setText(elements.expiringProjects, expiringCount);
        setText(elements.pendingProjects, pendingCount);
    }

    /* -----------------------------------------------------
       SEARCH AND FILTER
    ----------------------------------------------------- */

    function applyFilters() {
        const query = state.search.trim().toLowerCase();

        state.filteredProjects = state.projects.filter((project) => {
            const searchable = [
                project.title,
                project.description,
                project.domain,
                project.project_type,
                project.technologies,
                project.team_name,
                project.order_reference
            ]
                .map((value) => String(value ?? ""))
                .join(" ")
                .toLowerCase();

            const matchesSearch = !query || searchable.includes(query);

            let matchesStatus = true;

            switch (state.status) {
                case "active":
                case "expiring":
                case "expired":
                case "pending":
                    matchesStatus = project._status === state.status;
                    break;

                case "all":
                default:
                    matchesStatus = true;
                    break;
            }

            return matchesSearch && matchesStatus;
        });

        state.currentPage = 1;

        renderProjectCards();
        updatePagination();
    }

    /* -----------------------------------------------------
       PROJECT CARD RENDERING
    ----------------------------------------------------- */

    function renderProjectCard(project) {
        const card = createElement("article", "project-card");

        const header = createElement("div", "project-card-header");
        const titleWrap = createElement("div", "project-card-title-wrap");

        if (project.domain) {
            titleWrap.append(
                createElement(
                    "span",
                    "project-card-domain",
                    project.domain
                )
            );
        }

        const title = createElement(
            "h3",
            "project-card-title",
            project.title || "Untitled project"
        );

        titleWrap.append(title);

        const status = createElement(
            "span",
            `project-status ${statusClass(project._status)}`,
            statusLabel(project._status)
        );

        header.append(titleWrap, status);

        const body = createElement("div", "project-card-body");

        const description = createElement(
            "p",
            "project-card-description",
            project.description || "No project description is available."
        );

        body.append(description);

        const meta = createElement("div", "project-card-meta");

        if (project.project_type) {
            meta.append(
                createMetaItem("Type", project.project_type)
            );
        }

        if (project.team_name) {
            meta.append(
                createMetaItem("Team", project.team_name)
            );
        }

        if (project.order_reference) {
            meta.append(
                createMetaItem("Order", project.order_reference)
            );
        }

        if (meta.childElementCount > 0) {
            body.append(meta);
        }

        if (project.technologies) {
            const technologies = Array.isArray(project.technologies)
                ? project.technologies
                : String(project.technologies)
                    .split(/[,|]/)
                    .map((technology) => technology.trim())
                    .filter(Boolean);

            if (technologies.length) {
                const technologyWrap = createElement(
                    "div",
                    "project-technologies"
                );

                technologies.slice(0, 10).forEach((technology) => {
                    technologyWrap.append(
                        createElement(
                            "span",
                            "project-tech-tag",
                            technology
                        )
                    );
                });

                body.append(technologyWrap);
            }
        }

        const accessInfo = createElement("div", "project-access-info");

        const accessStart = project.access_starts_at;
        const accessExpiry = project.access_expires_at;

        const startItem = createElement("div", "project-access-item");
        startItem.append(
            createElement("span", "project-access-label", "Access starts"),
            createElement(
                "strong",
                "project-access-value",
                formatDate(accessStart)
            )
        );

        const expiryItem = createElement("div", "project-access-item");

        expiryItem.append(
            createElement("span", "project-access-label", "Access expires"),
            createElement(
                "strong",
                `project-access-value ${
                    project._status === "expired"
                        ? "is-expired"
                        : project._status === "expiring"
                            ? "is-expiring"
                            : ""
                }`,
                formatDate(accessExpiry)
            )
        );

        accessInfo.append(startItem, expiryItem);
        body.append(accessInfo);

        const footer = createElement("div", "project-card-footer");

        const priceWrap = createElement("div", "project-card-price");

        priceWrap.append(
            createElement("span", "project-card-price-label", "Purchase amount"),
            createElement(
                "strong",
                "project-card-price-value",
                formatCurrency(
                    project.amount ?? project.university_price ?? 0,
                    project.currency || "INR"
                )
            )
        );

        const actions = createElement("div", "project-card-actions");

        /*
         * A project must not become accessible simply because
         * a button exists. The backend must verify purchase
         * ownership and active access on every protected request.
         */
        if (project._status === "active" || project._status === "expiring") {
            const accessUrl = safeInternalUrl(project.access_url);

            if (accessUrl) {
                const accessLink = createElement(
                    "a",
                    "project-action-button project-action-primary",
                    "Open project"
                );

                accessLink.href = accessUrl;
                actions.append(accessLink);
            } else {
                const unavailable = createElement(
                    "span",
                    "project-action-button",
                    "Access details unavailable"
                );

                unavailable.setAttribute("aria-disabled", "true");
                actions.append(unavailable);
            }
        } else if (project._status === "pending") {
            const pending = createElement(
                "span",
                "project-action-button",
                "Awaiting payment"
            );

            pending.setAttribute("aria-disabled", "true");
            actions.append(pending);
        }

        footer.append(priceWrap, actions);
        card.append(header, body, footer);

        return card;
    }

    function safeInternalUrl(value) {
        if (!value || typeof value !== "string") {
            return null;
        }

        try {
            const url = new URL(value, window.location.href);

            if (url.origin !== window.location.origin) {
                return null;
            }

            if (!/^https?:$/.test(url.protocol)) {
                return null;
            }

            return url.href;
        } catch {
            return null;
        }
    }

    function renderProjectCards() {
        if (!elements.grid) {
            return;
        }

        elements.grid.replaceChildren();

        const filtered = state.filteredProjects;
        const total = filtered.length;
        const startIndex = (state.currentPage - 1) * CONFIG.pageSize;
        const pageItems = filtered.slice(
            startIndex,
            startIndex + CONFIG.pageSize
        );

        pageItems.forEach((project) => {
            elements.grid.append(renderProjectCard(project));
        });

        const hasResults = pageItems.length > 0;

        show(elements.empty, !hasResults && !state.loading);
        show(elements.grid, hasResults);

        if (!hasResults) {
            const hasFilters =
                state.search.trim() !== "" ||
                state.status !== "all";

            setText(
                elements.emptyTitle,
                hasFilters
                    ? "No matching projects"
                    : "Your project library is waiting"
            );

            setText(
                elements.emptyDescription,
                hasFilters
                    ? "Try changing your search or status filter."
                    : "Projects purchased by your institution will appear here once the backend confirms access."
            );
        }

        updatePagination();
    }

    /* -----------------------------------------------------
       PAGINATION
    ----------------------------------------------------- */

    function updatePagination() {
        const total = state.filteredProjects.length;
        const pageCount = Math.max(
            1,
            Math.ceil(total / CONFIG.pageSize)
        );

        state.currentPage = Math.min(state.currentPage, pageCount);

        const start = total
            ? (state.currentPage - 1) * CONFIG.pageSize + 1
            : 0;

        const end = Math.min(
            state.currentPage * CONFIG.pageSize,
            total
        );

        show(elements.pagination, total > CONFIG.pageSize);

        setText(
            elements.paginationInfo,
            total
                ? `Showing ${start}–${end} of ${total} projects`
                : "No projects to display"
        );

        if (elements.previousPage) {
            elements.previousPage.disabled = state.currentPage <= 1;
        }

        if (elements.nextPage) {
            elements.nextPage.disabled = state.currentPage >= pageCount;
        }
    }

    function goToPage(direction) {
        const pageCount = Math.max(
            1,
            Math.ceil(state.filteredProjects.length / CONFIG.pageSize)
        );

        state.currentPage = Math.min(
            pageCount,
            Math.max(1, state.currentPage + direction)
        );

        renderProjectCards();

        elements.grid?.scrollIntoView({
            behavior: window.matchMedia(
                "(prefers-reduced-motion: reduce)"
            ).matches ? "auto" : "smooth",
            block: "start"
        });
    }

    /* -----------------------------------------------------
       RENDER ALL
    ----------------------------------------------------- */

    function renderAll() {
        updateStats();
        applyFilters();

        clearError();
        hideNotice();

        if (state.projects.length === 0) {
            show(elements.empty, true);
        }
    }

    /* -----------------------------------------------------
       EVENTS
    ----------------------------------------------------- */

    function bindEvents() {
        elements.search?.addEventListener("input", (event) => {
            state.search = event.target.value || "";
            applyFilters();
        });

        elements.statusFilter?.addEventListener("change", (event) => {
            state.status = event.target.value || "all";
            applyFilters();
        });

        elements.refreshButton?.addEventListener("click", () => {
            requestProjects();
        });

        elements.retryButton?.addEventListener("click", () => {
            requestProjects();
        });

        elements.previousPage?.addEventListener("click", () => {
            goToPage(-1);
        });

        elements.nextPage?.addEventListener("click", () => {
            goToPage(1);
        });

        /*
         * Do not implement a separate logout handler here.
         * The shared institute-layout.js owns the account menu
         * and logout interaction used by dashboard.html.
         */
    }

    /* -----------------------------------------------------
       STARTUP
    ----------------------------------------------------- */

    function init() {
        initializeHeader();
        bindEvents();

        if (!elements.grid) {
            console.error(
                "[Foundev My Projects] Missing #my-projects-grid element."
            );
            return;
        }

        setSystemStatus(false, "Connecting");
        requestProjects();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
