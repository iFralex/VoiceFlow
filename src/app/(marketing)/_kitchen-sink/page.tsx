/**
 * Kitchen-sink component verification page.
 * Gated by NEXT_PUBLIC_SHOW_KITCHEN_SINK env var — not linked in production nav.
 * Renders each shadcn primitive to verify no console errors on mount.
 */

import { notFound } from 'next/navigation';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NavigationMenu, NavigationMenuContent, NavigationMenuItem, NavigationMenuLink, NavigationMenuList, NavigationMenuTrigger } from '@/components/ui/navigation-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export default function KitchenSinkPage() {
  if (process.env.NEXT_PUBLIC_SHOW_KITCHEN_SINK !== 'true') {
    notFound();
  }

  return (
    <TooltipProvider>
      <div className="container mx-auto max-w-4xl space-y-10 p-8">
        <h1 className="text-2xl font-bold">Kitchen Sink — shadcn/ui Primitives</h1>

        {/* Button */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Button</h2>
          <div className="flex flex-wrap gap-2">
            <Button>Default</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </div>
        </section>

        <Separator />

        {/* Input / Label / Textarea */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Input / Label / Textarea</h2>
          <div className="max-w-sm space-y-3">
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="marco@example.it" />
            </div>
            <Textarea placeholder="Scrivi qui…" rows={3} />
          </div>
        </section>

        <Separator />

        {/* Select */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Select</h2>
          <Select>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Seleziona…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="it">Italiano</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </section>

        <Separator />

        {/* Checkbox / Radio / Switch */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Checkbox / Radio / Switch</h2>
          <div className="flex items-center gap-2">
            <Checkbox id="chk" />
            <Label htmlFor="chk">Accetta termini</Label>
          </div>
          <RadioGroup defaultValue="it">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="it" id="r-it" />
              <Label htmlFor="r-it">Italiano</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="en" id="r-en" />
              <Label htmlFor="r-en">English</Label>
            </div>
          </RadioGroup>
          <div className="flex items-center gap-2">
            <Switch id="sw" />
            <Label htmlFor="sw">Notifiche email</Label>
          </div>
        </section>

        <Separator />

        {/* Card */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Card</h2>
          <Card className="w-64">
            <CardHeader>
              <CardTitle>Credito residuo</CardTitle>
              <CardDescription>Minuti disponibili</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="font-mono-tabular text-2xl">120 min</p>
            </CardContent>
            <CardFooter>
              <Button size="sm" variant="outline">Ricarica</Button>
            </CardFooter>
          </Card>
        </section>

        <Separator />

        {/* Badge */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Badge</h2>
          <div className="flex gap-2">
            <Badge>Attivo</Badge>
            <Badge variant="secondary">Bozza</Badge>
            <Badge variant="outline">Completato</Badge>
            <Badge variant="destructive">Errore</Badge>
          </div>
        </section>

        <Separator />

        {/* Alert */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Alert</h2>
          <Alert>
            <AlertTitle>Informazione</AlertTitle>
            <AlertDescription>La campagna è in attesa di approvazione.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <AlertTitle>Errore</AlertTitle>
            <AlertDescription>Credito insufficiente per avviare la campagna.</AlertDescription>
          </Alert>
        </section>

        <Separator />

        {/* Accordion */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Accordion</h2>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="item-1">
              <AccordionTrigger>Campagna attiva</AccordionTrigger>
              <AccordionContent>
                Mostra i dettagli della campagna selezionata.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-2">
              <AccordionTrigger>Impostazioni avanzate</AccordionTrigger>
              <AccordionContent>
                Configura i parametri avanzati della campagna.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>

        <Separator />

        {/* Tabs */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Tabs</h2>
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Panoramica</TabsTrigger>
              <TabsTrigger value="calls">Chiamate</TabsTrigger>
              <TabsTrigger value="settings">Impostazioni</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">Panoramica della campagna.</TabsContent>
            <TabsContent value="calls">Lista chiamate.</TabsContent>
            <TabsContent value="settings">Configurazione.</TabsContent>
          </Tabs>
        </section>

        <Separator />

        {/* Table */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Table</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contatto</TableHead>
                <TableHead>Telefono</TableHead>
                <TableHead>Stato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Mario Rossi</TableCell>
                <TableCell className="font-mono-tabular">+39 02 1234567</TableCell>
                <TableCell><Badge>Risposto</Badge></TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Anna Bianchi</TableCell>
                <TableCell className="font-mono-tabular">+39 06 9876543</TableCell>
                <TableCell><Badge variant="outline">Nessuna risposta</Badge></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </section>

        <Separator />

        {/* Skeleton */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Skeleton</h2>
          <div className="space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-32" />
          </div>
        </section>

        <Separator />

        {/* Avatar */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Avatar</h2>
          <div className="flex gap-2">
            <Avatar>
              <AvatarImage src="/placeholder-avatar.png" alt="Mario" />
              <AvatarFallback>MR</AvatarFallback>
            </Avatar>
            <Avatar>
              <AvatarFallback>AB</AvatarFallback>
            </Avatar>
          </div>
        </section>

        <Separator />

        {/* Tooltip */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Tooltip</h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">Passa sopra</Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Questo è un tooltip</p>
            </TooltipContent>
          </Tooltip>
        </section>

        <Separator />

        {/* Dialog */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Dialog</h2>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Apri Dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Conferma azione</DialogTitle>
                <DialogDescription>Stai per eliminare il contatto.</DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
        </section>

        <Separator />

        {/* Alert Dialog */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Alert Dialog</h2>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Elimina</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                <AlertDialogDescription>
                  Questa azione non può essere annullata.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annulla</AlertDialogCancel>
                <AlertDialogAction>Conferma</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>

        <Separator />

        {/* Popover */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Popover</h2>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">Apri Popover</Button>
            </PopoverTrigger>
            <PopoverContent>
              <p className="text-sm">Contenuto del popover.</p>
            </PopoverContent>
          </Popover>
        </section>

        <Separator />

        {/* Sheet / Drawer */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Sheet / Drawer</h2>
          <div className="flex gap-2">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Apri Sheet</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Impostazioni</SheetTitle>
                  <SheetDescription>Modifica le tue preferenze.</SheetDescription>
                </SheetHeader>
              </SheetContent>
            </Sheet>
            <Drawer>
              <DrawerTrigger asChild>
                <Button variant="outline">Apri Drawer</Button>
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>Aggiungi contatto</DrawerTitle>
                  <DrawerDescription>Inserisci i dati del contatto.</DrawerDescription>
                </DrawerHeader>
              </DrawerContent>
            </Drawer>
          </div>
        </section>

        <Separator />

        {/* Dropdown Menu */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Dropdown Menu</h2>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">Menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Azioni</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Visualizza</DropdownMenuItem>
              <DropdownMenuItem>Modifica</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive">Elimina</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </section>

        <Separator />

        {/* Navigation Menu */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Navigation Menu</h2>
          <NavigationMenu>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuTrigger>Dashboard</NavigationMenuTrigger>
                <NavigationMenuContent>
                  <NavigationMenuLink href="/dashboard">Panoramica</NavigationMenuLink>
                </NavigationMenuContent>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
        </section>

        <Separator />

        {/* Command */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Command</h2>
          <Command className="rounded-lg border shadow-md">
            <CommandInput placeholder="Cerca…" />
            <CommandList>
              <CommandEmpty>Nessun risultato.</CommandEmpty>
              <CommandGroup heading="Pagine">
                <CommandItem>Dashboard</CommandItem>
                <CommandItem>Campagne</CommandItem>
                <CommandItem>Contatti</CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </section>

        <Separator />

        {/* Scroll Area */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Scroll Area</h2>
          <ScrollArea className="h-32 w-64 rounded-lg border p-3">
            {Array.from({ length: 20 }, (_, i) => (
              <div key={i} className="py-1 text-sm">
                Elemento {i + 1}
              </div>
            ))}
          </ScrollArea>
        </section>

        <Separator />

        {/* Calendar */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Calendar</h2>
          <Calendar mode="single" className="rounded-lg border" />
        </section>
      </div>
    </TooltipProvider>
  );
}
