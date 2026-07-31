import { useEffect, useRef, useState } from "react";
import {
  reactExtension,
  useApi,
  useApplyDiscountCodeChange,
  BlockStack,
  InlineStack,
  Button,
  Text,
  Banner,
  Divider,
  SkeletonText,
} from "@shopify/ui-extensions-react/checkout";

// The app backend that authenticates the checkout session token and runs the
// shared redeem() flow. network_access (in the toml) permits this call.
const APP_URL = "https://loyara.velihantoptas.com";

export default reactExtension(
  "purchase.checkout.reductions.render-after",
  () => <Loyara />,
);

type Tier = {
  index: number;
  points: number;
  value: number;
  type: "fixed" | "percent";
};
type State = {
  ok: boolean;
  active: boolean;
  loggedIn: boolean;
  currency: string;
  redemptionMode: "discount" | "store_credit";
  balance?: number;
  tiers?: Tier[];
};

function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "k" + Date.now() + Math.random().toString(36).slice(2);
  }
}

function money(v: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(v);
  } catch {
    return v + " " + currency;
  }
}

function Loyara() {
  const { sessionToken } = useApi();
  const applyDiscountCode = useApplyDiscountCodeChange();
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{
    tone: "success" | "critical";
    text: string;
  } | null>(null);
  const keys = useRef<Record<number, string>>({});

  async function authFetch(path: string, init?: RequestInit) {
    const token = await sessionToken.get();
    return fetch(APP_URL + path, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
  }

  useEffect(() => {
    let alive = true;
    authFetch("/checkout/state")
      .then((r) => r.json())
      .then((d: State) => {
        if (alive) setState(d);
      })
      .catch(() => {
        if (alive)
          setState({
            ok: false,
            active: false,
            loggedIn: false,
            currency: "USD",
            redemptionMode: "discount",
          });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!state) return <SkeletonText />;
  // Only render for a logged-in member of an active program with something to do.
  if (!state.ok || !state.active || !state.loggedIn) return null;
  const tiers = state.tiers || [];
  if (tiers.length === 0 && !msg) return null;

  function label(t: Tier): string {
    const amount = money(t.value, state!.currency);
    if (state!.redemptionMode === "store_credit" && t.type !== "percent")
      return amount + " store credit";
    return t.type === "percent" ? t.value + "% off" : amount + " off";
  }

  async function redeem(t: Tier) {
    if (busy != null) return;
    setBusy(t.index);
    setMsg(null);
    if (!keys.current[t.index]) keys.current[t.index] = uuid();
    try {
      const r = await authFetch("/checkout/redeem", {
        method: "POST",
        body: JSON.stringify({
          tierIndex: t.index,
          idempotencyKey: keys.current[t.index],
        }),
      });
      const d = await r.json();
      if (d && d.ok) {
        if (d.mode === "store_credit" || d.credited != null) {
          setMsg({
            tone: "success",
            text:
              money(d.credited, state!.currency) +
              " store credit added — it applies at checkout.",
          });
        } else if (d.code) {
          const res = await applyDiscountCode({
            type: "addDiscountCode",
            code: d.code,
          });
          if (res.type === "error")
            setMsg({
              tone: "critical",
              text: "Reward created but couldn't auto-apply. Code: " + d.code,
            });
          else
            setMsg({
              tone: "success",
              text: "Applied " + label(t) + " for " + t.points + " points.",
            });
        }
        // Reflect the spend and drop the redeemed tier.
        setState((s) =>
          s
            ? {
                ...s,
                balance: Math.max(0, (s.balance || 0) - t.points),
                tiers: (s.tiers || []).filter((x) => x.index !== t.index),
              }
            : s,
        );
      } else {
        delete keys.current[t.index];
        setMsg({
          tone: "critical",
          text:
            d?.error === "insufficient"
              ? "Not enough points."
              : "That didn't work — please try again.",
        });
      }
    } catch {
      delete keys.current[t.index];
      setMsg({ tone: "critical", text: "Network error — please try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <BlockStack spacing="base">
      <Divider />
      <Text emphasis="bold">Loyalty points</Text>
      <Text appearance="subdued">You have {state.balance} points.</Text>
      {msg ? <Banner status={msg.tone}>{msg.text}</Banner> : null}
      {tiers.map((t) => (
        <InlineStack key={t.index} spacing="base" blockAlignment="center">
          <Button
            kind="secondary"
            loading={busy === t.index}
            disabled={busy != null}
            onPress={() => redeem(t)}
          >
            Redeem {t.points} pts → {label(t)}
          </Button>
        </InlineStack>
      ))}
    </BlockStack>
  );
}
